# LEO: Auto-typing Tool for Teaching Coding

**LEO** is an Electron-based auto-typing application designed for live coding demonstrations, programming tutorials, and technical presentations. It allows instructors to prepare lessons in advance and "type" them out smoothly during presentations, ensuring stress-free demonstrations while maintaining the authentic feel of live coding.

**LEO** was originally developed in [Python](https://github.com/gniziemazity/LEO) and created to help with making programming tutorials. This Electron version adds new features specifically tailored for in-class demos.

To best understand how **LEO** works, please check the [Video Tutorial](https://youtu.be/hHYjqfI19r0) and read the [Paper](https://dl.acm.org/doi/10.1145/3769994.3770055).

## ✨ Features

### 🎯 Core Features
- **Auto-Typing Mode**: Press any hotkey to advance through pre-written code character by character
- **Comment Blocks**: Brief explanations for the teacher
- **Code Blocks**: Character-by-character auto-typed code snippets
- **Visual Progress**: Real-time progress bar and cursor highlighting
- **Timer Integration**: Presentation timer with adjustable duration
- **Remote Viewing**: Mobile-friendly client viewer via WebSocket connection

### ⚙️ Advanced Features
- **Global Hotkeys**: Control typing from anywhere, even when window is not focused
- **Always On Top**: Keep LEO visible over your IDE or presentation
- **Transparency Toggle**: Adjust window opacity for overlay presentations
- **Special Characters**: Easy insertion of navigation keys (←, →, ↑, ↓) and shortcuts (💾, 🔁)
- **Keystroke Logging**: Automatic session logging for performance analysis
- **Customizable Styling**: Configure colors, fonts, and appearance
- **Code Formatting**: Auto-format code (f)

## 📋 Prerequisites

- **Node.js** (v14 or higher)
- **npm** or **yarn**

## 🚀 Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/leo.git
cd leo

# Install dependencies
npm install

# Start the application
npm start
```

## 📖 Usage

### Creating a Lesson

1. **Launch LEO** and go to File → New Plan (`Ctrl+N`)
2. **Add blocks**:
   - **Yellow +** button: Add comment block (for explanations)
   - **White +** button: Add code block (for typing simulation)
3. **Edit content**: Click on any block to edit its content
4. **Save**: File → Save Plan (`Ctrl+S`)

### Running a Lesson

1. **Load a lesson**: File → Load Plan (`Ctrl+O`)
2. **Click START** or press `Ctrl+P` to toggle auto-typing mode
3. **Press any letter key** (a-z) to advance through the lesson
4. **Navigate**:
   - `Ctrl+Left`: Step backward
   - `Ctrl+Right`: Step forward
   - Click on any character to jump to that position

### VS Code Setup (Optional)

If you don't have a preferred code editor, I recommend [VS Code](https://code.visualstudio.com)
It comes with advanced features that help experienced coders. These (may) interfere with LEO lesson plans.
You can disable them by loading the VS Code settings provided in the settings folder.

**How to Apply Settings**:
1. Open VS Code.
2. Press `Ctrl + Shift + P`.
3. Search for **"Open User Settings (JSON)"**.
4. Paste the contents of the desired JSON file into the settings and save.

### Remote Viewing (Mobile/Tablet)

1. Start LEO on your computer
2. Look for the console output showing the WebSocket URL with QR code
3. Scan the QR code or visit the URL on your mobile device
4. The mobile viewer will sync automatically with your presentation

## ⌨️ Keyboard Shortcuts

### Default Hotkeys

| Action | Shortcut |
|--------|----------|
| Toggle Typing Mode | `Ctrl+P` |
| Step Backward | `Ctrl+Left` |
| Step Forward | `Ctrl+Right` |
| Always On Top | `Ctrl+Shift+Space` |
| Toggle Transparency | `Ctrl+Shift+T` |
| New Plan | `Ctrl+N` |
| Save Plan | `Ctrl+S` |
| Load Plan | `Ctrl+O` |
| Settings | `Ctrl+,` |

### Typing Hotkeys
By default, **any letter key (a-z)** advances the cursor when in typing mode.

All hotkeys are customizable via Settings.

## 🎨 Special Characters

LEO includes quick-insert buttons for special characters commonly used in coding demonstrations:

- **Navigation**: ←, →, ↑, ↓, ◄, ►, ▲, ▼
- **Editing**: ↢ (Backspace), ‒ (Tab)
- **Shift Navigation**: ⇑, ⇓, ⇐, ⇒
- **Shortcuts**: 💾 (Save: Ctrl+S), 🔁 (Alt+Tab)

## 📁 Lesson File Format

Lessons are stored as JSON files:

```json
[
  {
    "type": "comment",
    "text": "Welcome to the lesson!"
  },
  {
    "type": "code",
    "text": "function hello() {\n  console.log('Hello, World!');\n}"
  }
]
```

### Block Types

- **`comment`**: Brief explanations for the teacher (not auto-typed)
- **`code`**: Text typed character-by-character (for controlled pacing)

## ⚙️ Configuration

Access settings via File → Settings (`Ctrl+,`).

### Customizable Settings

#### Hotkeys
- Auto-typing trigger keys
- Toggle active shortcut
- Navigation shortcuts
- System shortcuts (always on top, transparency)

#### Colors
- Comment block colors (normal, active, selected)
- Active text color
- Cursor color
- Border colors
- Text color

#### Appearance
- Font size (10-24px)

Settings persist across sessions.

## 📊 Keystroke Logging

LEO automatically logs all keystrokes during sessions for analysis:

- Logs saved to `logs/` directory next to your lesson file
- Includes timestamps, characters typed, and session metadata
- Auto-saves every 10 keystrokes
- Format: `lessonname_key_presses_TIMESTAMP.json`

## 🔧 Development

### Running in Development Mode

```bash
npm start
```

### Building for Production

```bash
npm run build
```

### Running Tests

```bash
npm test
```

## 🐛 Troubleshooting

### Hotkeys Not Working
- Check if another application is using the same shortcuts
- Try customizing hotkeys in Settings

### Mobile Viewer Not Connecting
- Ensure firewall allows connections on port 8080
- Check that devices are on the same network

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with [Electron](https://www.electronjs.org/)
- Keyboard automation powered by [@computer-use/nut-js](https://www.npmjs.com/package/@computer-use/nut-js)
- WebSocket server using [ws](https://github.com/websockets/ws)