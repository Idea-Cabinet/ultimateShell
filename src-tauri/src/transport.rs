use crate::pty::SpawnOptions;
use std::io::{Read, Write};
use std::net::{IpAddr, TcpStream, ToSocketAddrs};
use std::os::fd::{AsRawFd, RawFd};
use std::os::unix::net::UnixStream;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::time::Duration;

pub enum Transport {
    Direct(TcpStream),
    Jump(JumpSocket),
}
impl AsRawFd for Transport {
    fn as_raw_fd(&self) -> RawFd {
        match self {
            Self::Direct(s) => s.as_raw_fd(),
            Self::Jump(s) => s.socket.as_raw_fd(),
        }
    }
}
pub struct JumpSocket {
    socket: UnixStream,
    stop: Arc<AtomicBool>,
}
impl Drop for JumpSocket {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

fn tcp(host: &str, port: u16) -> Result<TcpStream, String> {
    let addresses = (host, port)
        .to_socket_addrs()
        .map_err(|e| format!("解析文件连接地址失败：{e}"))?;
    let mut last = None;
    for address in addresses {
        match TcpStream::connect_timeout(&address, Duration::from_secs(5)) {
            Ok(s) => {
                s.set_nodelay(true).ok();
                s.set_read_timeout(Some(Duration::from_secs(15))).ok();
                s.set_write_timeout(Some(Duration::from_secs(15))).ok();
                return Ok(s);
            }
            Err(e) => last = Some(e),
        }
    }
    Err(format!(
        "建立文件连接失败：{}",
        last.map(|e| e.to_string())
            .unwrap_or_else(|| "无可用地址".into())
    ))
}

fn socks(
    stream: &mut TcpStream,
    host: &str,
    port: u16,
    user: &str,
    password: Option<&str>,
) -> std::io::Result<()> {
    let auth = !user.is_empty();
    stream.write_all(if auth { &[5, 2, 0, 2] } else { &[5, 1, 0] })?;
    let mut reply = [0; 2];
    stream.read_exact(&mut reply)?;
    if reply[0] != 5 {
        return Err(std::io::Error::other("无效的 SOCKS5 响应"));
    }
    match reply[1] {
        0 => {}
        2 if auth => {
            let password = password.unwrap_or("");
            if user.len() > 255 || password.len() > 255 {
                return Err(std::io::Error::other("代理凭据过长"));
            }
            let mut request = vec![1, user.len() as u8];
            request.extend(user.as_bytes());
            request.push(password.len() as u8);
            request.extend(password.as_bytes());
            stream.write_all(&request)?;
            stream.read_exact(&mut reply)?;
            if reply != [1, 0] {
                return Err(std::io::Error::other("SOCKS5 代理认证失败"));
            }
        }
        _ => return Err(std::io::Error::other("SOCKS5 代理拒绝认证方式")),
    }
    let mut request = vec![5, 1, 0];
    match host.parse::<IpAddr>() {
        Ok(IpAddr::V4(ip)) => {
            request.push(1);
            request.extend(ip.octets());
        }
        Ok(IpAddr::V6(ip)) => {
            request.push(4);
            request.extend(ip.octets());
        }
        Err(_) if host.len() <= 255 => {
            request.extend([3, host.len() as u8]);
            request.extend(host.as_bytes());
        }
        _ => return Err(std::io::Error::other("目标主机名过长")),
    }
    request.extend(port.to_be_bytes());
    stream.write_all(&request)?;
    let mut head = [0; 4];
    stream.read_exact(&mut head)?;
    if head[0] != 5 || head[1] != 0 {
        return Err(std::io::Error::other(format!(
            "SOCKS5 转发被拒绝（状态 {}）",
            head[1]
        )));
    }
    let length = match head[3] {
        1 => 4,
        4 => 16,
        3 => {
            let mut len = [0];
            stream.read_exact(&mut len)?;
            len[0] as usize
        }
        _ => return Err(std::io::Error::other("无效代理地址")),
    };
    let mut discard = vec![0; length + 2];
    stream.read_exact(&mut discard)
}

fn http(
    stream: &mut TcpStream,
    host: &str,
    port: u16,
    user: &str,
    password: Option<&str>,
) -> std::io::Result<()> {
    if host.contains(['\r', '\n', ' ']) {
        return Err(std::io::Error::other("目标主机地址无效"));
    }
    let authority = if host.contains(':') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    };
    let mut request = format!("CONNECT {authority} HTTP/1.1\r\nHost: {authority}\r\n");
    if !user.is_empty() {
        use base64::Engine;
        let credentials = base64::engine::general_purpose::STANDARD
            .encode(format!("{user}:{}", password.unwrap_or("")));
        request.push_str(&format!("Proxy-Authorization: Basic {credentials}\r\n"));
    }
    request.push_str("\r\n");
    stream.write_all(request.as_bytes())?;
    let mut response = Vec::new();
    while !response.ends_with(b"\r\n\r\n") {
        if response.len() >= 16384 {
            return Err(std::io::Error::other("HTTP 代理响应过长"));
        }
        let mut byte = [0];
        stream.read_exact(&mut byte)?;
        response.push(byte[0]);
    }
    let text = String::from_utf8_lossy(&response);
    let status = text
        .lines()
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .unwrap_or("");
    if status != "200" {
        return Err(std::io::Error::other(format!(
            "HTTP 代理 CONNECT 失败（状态 {status}）"
        )));
    }
    Ok(())
}

fn direct_or_proxy(opts: &SpawnOptions) -> Result<TcpStream, String> {
    let host = opts.host.as_deref().ok_or("文件连接主机为空")?;
    let port = opts.port.unwrap_or(22);
    if opts.proxy_type.as_deref() != Some("proxy") {
        return tcp(host, port);
    }
    let raw = opts
        .proxy_url
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("文件连接缺少代理地址")?;
    let address = if raw.contains("://") {
        raw.to_string()
    } else {
        format!("socks5://{raw}")
    };
    let url = tauri::Url::parse(&address).map_err(|_| "代理地址格式错误".to_string())?;
    let proxy_host = url.host_str().ok_or("代理主机为空")?;
    let proxy_port = url
        .port()
        .unwrap_or(if url.scheme() == "http" { 8080 } else { 1080 });
    let mut stream = tcp(proxy_host, proxy_port)?;
    let result = match url.scheme() {
        "socks5" | "socks5h" => socks(&mut stream, host, port, url.username(), url.password()),
        "http" => http(&mut stream, host, port, url.username(), url.password()),
        _ => return Err("文件连接仅支持 HTTP CONNECT 或 SOCKS5 代理".into()),
    };
    result.map_err(|e| format!("文件连接代理握手失败：{e}"))?;
    Ok(stream)
}

pub fn connect(opts: &SpawnOptions) -> Result<Transport, String> {
    if opts.proxy_type.as_deref() != Some("jump") {
        return direct_or_proxy(opts).map(Transport::Direct);
    }
    let id = opts
        .jump_host_id
        .as_deref()
        .ok_or("未选择文件连接的跳板机")?;
    let jump = crate::hosts::load_hosts()
        .into_iter()
        .find(|h| h.id == id)
        .ok_or("跳板机配置不存在")?;
    if jump.proxy_type.as_deref() == Some("jump") {
        return Err("文件连接暂不支持嵌套跳板，请配置单级跳板或代理。".into());
    }
    let jump_opts = SpawnOptions {
        session_id: format!("{}-jump", opts.session_id),
        is_local: false,
        host_id: Some(jump.id),
        host_name: Some(jump.name),
        host: Some(jump.host),
        port: Some(jump.port),
        username: Some(jump.username),
        identity_file: jump.identity_file,
        proxy_type: jump.proxy_type,
        jump_host_id: jump.jump_host_id,
        proxy_url: jump.proxy_url,
        cols: None,
        rows: None,
    };
    let mut session = ssh2::Session::new().map_err(|e| e.to_string())?;
    session.set_timeout(15000);
    session.set_tcp_stream(direct_or_proxy(&jump_opts)?);
    session
        .handshake()
        .map_err(|e| format!("跳板机握手失败：{e}"))?;
    crate::sftp::verify_host_key(&session,&jump_opts)?;
    crate::sftp::authenticate(&session, &jump_opts).map_err(|e| format!("跳板机{e}"))?;
    let mut channel = session
        .channel_direct_tcpip(
            opts.host.as_deref().ok_or("目标主机为空")?,
            opts.port.unwrap_or(22),
            None,
        )
        .map_err(|e| format!("跳板机转发失败：{e}"))?;
    let (client, mut bridge) = UnixStream::pair().map_err(|e| e.to_string())?;
    bridge.set_nonblocking(true).map_err(|e| e.to_string())?;
    session.set_blocking(false);
    let stop = Arc::new(AtomicBool::new(false));
    let stopping = stop.clone();
    std::thread::spawn(move || {
        let _session = session;
        let mut outbound = Vec::new();
        let mut inbound = Vec::new();
        let mut buffer = [0; 16384];
        let mut remote_eof = false;
        while !stopping.load(Ordering::Relaxed) {
            let mut activity = false;
            if outbound.len() < 65536 {
                match bridge.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(n) => {
                        outbound.extend_from_slice(&buffer[..n]);
                        activity = true;
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                    Err(_) => break,
                }
            }
            if !outbound.is_empty() {
                match channel.write(&outbound) {
                    Ok(0) => break,
                    Ok(n) => {
                        outbound.drain(..n);
                        activity = true;
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                    Err(_) => break,
                }
            }
            if !remote_eof && inbound.len() < 65536 {
                match channel.read(&mut buffer) {
                    Ok(0) => remote_eof = true,
                    Ok(n) => {
                        inbound.extend_from_slice(&buffer[..n]);
                        activity = true;
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                    Err(_) => break,
                }
            }
            if !inbound.is_empty() {
                match bridge.write(&inbound) {
                    Ok(0) => break,
                    Ok(n) => {
                        inbound.drain(..n);
                        activity = true;
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                    Err(_) => break,
                }
            }
            if remote_eof && inbound.is_empty() {
                break;
            }
            if !activity {
                std::thread::sleep(Duration::from_millis(5));
            }
        }
        let _ = channel.close();
    });
    Ok(Transport::Jump(JumpSocket {
        socket: client,
        stop,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn socks_proxy_uses_target_domain_and_preserves_ssh_greeting() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            let mut greeting = [0; 3];
            s.read_exact(&mut greeting).unwrap();
            assert_eq!(greeting, [5, 1, 0]);
            s.write_all(&[5, 0]).unwrap();
            let mut header = [0; 5];
            s.read_exact(&mut header).unwrap();
            assert_eq!(&header[..4], &[5, 1, 0, 3]);
            let mut name = vec![0; header[4] as usize];
            s.read_exact(&mut name).unwrap();
            assert_eq!(name, b"private.example");
            let mut port = [0; 2];
            s.read_exact(&mut port).unwrap();
            assert_eq!(u16::from_be_bytes(port), 22);
            s.write_all(&[5, 0, 0, 1, 127, 0, 0, 1, 0, 22]).unwrap();
            s.write_all(b"SSH-2.0-fixture\r\n").unwrap();
        });
        let mut client = tcp("127.0.0.1", address.port()).unwrap();
        socks(&mut client, "private.example", 22, "", None).unwrap();
        let mut greeting = [0; 17];
        client.read_exact(&mut greeting).unwrap();
        assert_eq!(&greeting, b"SSH-2.0-fixture\r\n");
        server.join().unwrap();
    }
    #[test]
    fn http_proxy_preserves_bytes_after_connect_headers() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            let mut request = Vec::new();
            while !request.ends_with(b"\r\n\r\n") {
                let mut byte = [0];
                s.read_exact(&mut byte).unwrap();
                request.push(byte[0]);
            }
            assert!(String::from_utf8_lossy(&request).starts_with("CONNECT private.example:22"));
            s.write_all(b"HTTP/1.1 200 Connected\r\n\r\nSSH!").unwrap();
        });
        let mut client = tcp("127.0.0.1", address.port()).unwrap();
        http(&mut client, "private.example", 22, "", None).unwrap();
        let mut greeting = [0; 4];
        client.read_exact(&mut greeting).unwrap();
        assert_eq!(&greeting, b"SSH!");
        server.join().unwrap();
    }
}
