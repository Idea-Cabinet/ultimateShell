use tauri::menu::{AboutMetadata, MenuBuilder, MenuItemBuilder, SubmenuBuilder};

/// Keep native actions and accelerators intact while grouping less frequent actions.
pub fn install(app: &tauri::App) -> tauri::Result<()> {
    let app_menu = SubmenuBuilder::new(app, "UltimateShell")
        .about_with_text(
            "关于 UltimateShell",
            Some(AboutMetadata {
                name: Some("UltimateShell".into()),
                version: Some(app.package_info().version.to_string()),
                comments: Some("轻量级终端与服务器管理工具".into()),
                ..Default::default()
            }),
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("menu-settings", "设置…")
                .accelerator("CmdOrCtrl+,")
                .build(app)?,
        )
        .separator()
        .hide_with_text("隐藏 UltimateShell")
        .hide_others_with_text("隐藏其他应用")
        .show_all_with_text("显示全部")
        .separator()
        .quit_with_text("退出 UltimateShell")
        .build()?;

    let tabs_menu = SubmenuBuilder::new(app, "标签页")
        .item(
            &MenuItemBuilder::with_id("menu-prev-tab", "上一个标签页")
                .accelerator("CmdOrCtrl+Shift+[")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("menu-next-tab", "下一个标签页")
                .accelerator("CmdOrCtrl+Shift+]")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("menu-close-tab", "关闭当前标签页")
                .accelerator("CmdOrCtrl+W")
                .build(app)?,
        )
        .item(&MenuItemBuilder::with_id("menu-close-other-tabs", "关闭其他标签页").build(app)?)
        .build()?;
    let session_menu = SubmenuBuilder::new(app, "会话")
        .item(
            &MenuItemBuilder::with_id("menu-new-local-tab", "新建本地终端")
                .accelerator("CmdOrCtrl+T")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("menu-new-host", "新建服务器连接…")
                .accelerator("CmdOrCtrl+N")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("menu-duplicate-tab", "复制当前会话")
                .accelerator("CmdOrCtrl+D")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("menu-reconnect-session", "重新连接")
                .accelerator("CmdOrCtrl+R")
                .build(app)?,
        )
        .separator()
        .item(&tabs_menu)
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "编辑")
        .undo_with_text("撤销")
        .redo_with_text("重做")
        .separator()
        .cut_with_text("剪切")
        .copy_with_text("复制")
        .paste_with_text("粘贴")
        .select_all_with_text("全选")
        .separator()
        .item(
            &MenuItemBuilder::with_id("menu-clear-terminal", "清屏")
                .accelerator("CmdOrCtrl+K")
                .build(app)?,
        )
        .build()?;

    let panels_menu = SubmenuBuilder::new(app, "面板")
        .item(
            &MenuItemBuilder::with_id("menu-toggle-sidebar", "服务器列表")
                .accelerator("CmdOrCtrl+B")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("menu-toggle-cmd-assistant", "命令库")
                .accelerator("CmdOrCtrl+Shift+C")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("menu-toggle-ops-drawer", "文件与运维")
                .accelerator("CmdOrCtrl+J")
                .build(app)?,
        )
        .build()?;
    let font_menu = SubmenuBuilder::new(app, "终端字体")
        .item(
            &MenuItemBuilder::with_id("menu-zoom-in", "放大")
                .accelerator("CmdOrCtrl+=")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("menu-zoom-out", "缩小")
                .accelerator("CmdOrCtrl+-")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("menu-zoom-reset", "恢复默认大小")
                .accelerator("CmdOrCtrl+0")
                .build(app)?,
        )
        .build()?;
    let view_menu = SubmenuBuilder::new(app, "查看")
        .items(&[&panels_menu, &font_menu])
        .build()?;
    let window_menu = SubmenuBuilder::new(app, "窗口")
        .minimize_with_text("最小化")
        .maximize_with_text("缩放")
        .fullscreen_with_text("切换全屏")
        .separator()
        .bring_all_to_front_with_text("前置全部窗口")
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[
            &app_menu,
            &session_menu,
            &edit_menu,
            &view_menu,
            &window_menu,
        ])
        .build()?;
    app.set_menu(menu)?;
    Ok(())
}
