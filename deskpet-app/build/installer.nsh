!macro customInit
  ; 防止从浏览器下载的安装包在安装完成勾选“立即运行”时将 Internet Zone 传递给主程序触发安全警告
  System::Call 'kernel32::SetEnvironmentVariable(t "SEE_MASK_NOZONECHECKS", t "1")'
!macroend
