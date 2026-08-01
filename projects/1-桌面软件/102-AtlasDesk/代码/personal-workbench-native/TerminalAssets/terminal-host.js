(() => {
  const post = (message) => window.chrome.webview.postMessage(message);
  const terminal = new Terminal({
    cursorBlink: true,
    cursorStyle: 'bar',
    fontFamily: "'Cascadia Mono', Consolas, 'Microsoft YaHei UI', monospace",
    fontSize: 14,
    lineHeight: 1.12,
    letterSpacing: 0,
    scrollback: 8000,
    convertEol: false,
    allowTransparency: false,
    rightClickSelectsWord: false,
    theme: {
      background: '#0d1320',
      foreground: '#dce6f5',
      cursor: '#7da8ff',
      cursorAccent: '#0d1320',
      selectionBackground: '#355a8f99',
      black: '#1a2230', red: '#ff6b7a', green: '#6fdc8c', yellow: '#ffd166',
      blue: '#6da8ff', magenta: '#c792ea', cyan: '#5fd7e5', white: '#dce6f5',
      brightBlack: '#617087', brightRed: '#ff8793', brightGreen: '#8be8a2', brightYellow: '#ffe08a',
      brightBlue: '#8bbcff', brightMagenta: '#d8a7f3', brightCyan: '#83e4ee', brightWhite: '#ffffff'
    }
  });
  const fitAddon = new FitAddon.FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(document.getElementById('terminal'));

  let resizeTimer = 0;
  const fitAndReport = () => {
    try {
      fitAddon.fit();
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => post({ type: 'resize', cols: terminal.cols, rows: terminal.rows }), 40);
    } catch (_) { }
  };

  terminal.onData(data => post({ type: 'input', data }));
  terminal.attachCustomKeyEventHandler(event => {
    const key = (event.key || '').toLowerCase();
    if (event.type !== 'keydown') return true;
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 'c') {
      if (terminal.hasSelection()) post({ type: 'copy', data: terminal.getSelection() });
      return false;
    }
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 'v') {
      post({ type: 'paste-request' });
      return false;
    }
    if ((event.ctrlKey || event.metaKey) && key === 'c' && terminal.hasSelection()) {
      post({ type: 'copy', data: terminal.getSelection() });
      return false;
    }
    return true;
  });

  document.addEventListener('contextmenu', event => {
    event.preventDefault();
    post({ type: 'paste-request' });
  });

  window.chrome.webview.addEventListener('message', event => {
    const message = event.data || {};
    switch (message.type) {
      case 'output': terminal.write(message.data || ''); break;
      case 'clear': terminal.clear(); break;
      case 'reset': terminal.reset(); break;
      case 'focus': terminal.focus(); break;
      case 'settings':
        if (Number.isFinite(message.fontSize)) terminal.options.fontSize = message.fontSize;
        if (Number.isFinite(message.scrollback)) terminal.options.scrollback = message.scrollback;
        fitAndReport();
        break;
    }
  });

  window.addEventListener('resize', fitAndReport);
  if (window.ResizeObserver) new ResizeObserver(fitAndReport).observe(document.body);
  setTimeout(() => {
    fitAndReport();
    terminal.focus();
    post({ type: 'ready', cols: terminal.cols, rows: terminal.rows });
  }, 30);
})();
