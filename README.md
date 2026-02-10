# TestFlow — Test Automation IDE

<p align="center">
  <strong>Bridge manual testing and automation in a single desktop IDE.</strong>
</p>

<p align="center">
  Record → Inspect → Replay → Export
</p>

---

TestFlow is an Electron-based Test Automation IDE that lets QA engineers record manual browser interactions, inspect elements with smart locator generation, replay test flows, and export production-ready Selenium Python scripts — all without writing a single line of code.

## ✨ Features

### 🎬 Record & Replay
- **One-click recording** — Navigate, click, type, select, scroll — every action is captured automatically
- **Step-by-step replay** — Re-run recorded flows with visual step highlighting
- **Test case management** — Run, edit, duplicate, and download test cases as JSON

### 🔍 Element Inspector
- **Smart locator generation** — Automatically generates multiple locator strategies per element (ID, CSS, XPath, aria-label, data-testid, etc.)
- **Confidence ranking** — Locators are scored and ranked by reliability
- **Freeze mode** — Freeze the page DOM to safely inspect dynamic elements

### 📊 Test Data Management
- **Per-step test data** — Attach input values to each recorded step
- **Variable substitution** — Use `{{variables}}` in test data for dynamic values
- **Data separation** — Test data is exported separately from test scripts

### 📡 Network Monitor
- **Live network capture** — See all HTTP traffic during test replay
- **Per-test snapshots** — Network logs are saved per test case for later viewing
- **Download logs** — Export network data as JSON for debugging

### 📤 Export System
- **Selenium Python** — PEP8-compliant pytest scripts with:
  - Data-driven design (external JSON data files)
  - Multi-locator fallback (`find_with_fallback`)
  - Explicit waits (WebDriverWait + expected_conditions)
  - Optional Page Object Model structure
- **Markdown Report** — Human-readable test documentation with locator confidence bars, data masking, and element summaries
- **JSON Flow Data** — Normalized, versioned (v1.0.0) schema for CI/CD integration

### 🛠 Developer Tools
- **Console panel** — App-level logging with color-coded levels
- **Network panel** — Request method, URL, status, type, size, and timing
- **Replay log** — Step-by-step pass/fail results

## 📸 Screenshots

> _Coming soon_

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) 18+
- npm or yarn

### Install & Run

```bash
# Clone the repo
git clone https://github.com/xASHx26/testflow.git
cd testflow

# Install dependencies
npm install

# Launch the IDE
npm start
```

### Build for Production

```bash
# Windows
npm run build:win

# macOS
npm run build:mac

# Linux
npm run build:linux
```

## 🏗 Architecture

```
src/
├── main/                    # Electron main process
│   ├── main.js              # App entry point
│   ├── window-manager.js    # Window/BrowserView lifecycle
│   ├── menu.js              # Native application menu
│   ├── ipc-handlers.js      # IPC bridge (renderer ↔ main)
│   ├── project-manager.js   # Project save/load
│   └── services/
│       ├── browser-engine.js    # Embedded Chromium (BrowserView)
│       ├── recorder-engine.js   # Action recording
│       ├── replay-engine.js     # Test replay execution
│       ├── flow-engine.js       # Flow CRUD & step management
│       ├── locator-engine.js    # Smart locator generation
│       ├── export-engine.js     # Selenium/Markdown/JSON export
│       ├── screenshot-service.js
│       ├── freeze-service.js    # DOM freeze for inspection
│       ├── share-service.js     # Package import/export
│       └── auth-service.js
├── preload/
│   └── preload.js           # Secure contextBridge API
├── renderer/                # UI (vanilla JS, no framework)
│   ├── index.html
│   ├── js/
│   │   ├── app.js               # App bootstrap
│   │   ├── toolbar.js           # Navigation + recording controls
│   │   ├── flow-editor.js       # Flow list + step editor
│   │   ├── inspector-ui.js      # Element inspector panel
│   │   ├── panel-manager.js     # Resizable panel layout
│   │   ├── network-panel.js     # Network traffic viewer
│   │   ├── console-panel.js     # Console log viewer
│   │   ├── testcase-manager.js  # Test case CRUD
│   │   ├── event-bus.js         # Global event system
│   │   └── workspace.js         # Layout presets
│   ├── styles/                  # Dark theme CSS
│   └── components/              # Reusable UI components
├── inject/                  # Scripts injected into target pages
├── schemas/                 # JSON schemas
└── templates/               # Export templates
```

## 🔧 Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Electron 29 |
| UI | Vanilla JS + CSS (no framework) |
| Browser | BrowserView (Chromium) |
| IPC | contextBridge + ipcMain/ipcRenderer |
| Export | Selenium + Python (pytest) |
| Theme | Custom dark theme with CSS variables |

## 📋 Export Formats

| Format | Output | Use Case |
|--------|--------|----------|
| Selenium Python | `test_*.py` + `data/*.json` | CI/CD test automation |
| Markdown | `*_report.md` | Test documentation & review |
| JSON | `*.json` (schema v1.0.0) | Data interchange, backup |

## 🔑 Key Design Decisions

- **No framework dependency** — Pure vanilla JS for maximum performance and minimal bundle size
- **Context isolation** — `contextIsolation: true`, `nodeIntegration: false` for security
- **Data separation** — Test data never hardcoded in exported scripts
- **Locator fallback** — Multiple strategies with confidence scoring, never a single point of failure
- **Validation-first export** — Every export validates the flow before generating output

## 📄 License

MIT

## 🤝 Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

<p align="center">
  Built with ❤️ by <a href="https://github.com/xASHx26">xASHx26</a>
</p>
