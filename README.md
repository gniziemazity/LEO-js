# LEO: Auto-typing Tool for Teaching Coding

**LEO** is an Electron-based auto-typing application designed for live coding demonstrations, programming tutorials, and technical presentations. It allows instructors to prepare lessons in advance and "type" them out smoothly during presentations, ensuring stress-free demonstrations while maintaining the authentic feel of live coding.

**LEO** was originally developed in [Python](https://github.com/gniziemazity/LEO) and created to help with making programming tutorials. This Electron version adds new features specifically tailored for in-class demos.

To best understand how **LEO** works, please check the [Video Tutorial](https://youtu.be/hHYjqfI19r0) and read the [Paper](https://dl.acm.org/doi/10.1145/3769994.3770055).

## ✨ Features

### 🎯 Core Features

- **Auto-Typing (Code) Blocks**: Press any hotkey to advance through pre-written code character by character
- **Comment Blocks**: Brief explanations for the teacher
- **Question Blocks**: Comment Blocks starting with ❓ are logged as teacher questions
- **Visual Progress**: Real-time progress bar and cursor highlighting
- **Timer Integration**: Presentation timer with adjustable duration (default 90 minutes)
- **Remote Viewing**: Mobile-friendly client viewer via WebSocket connection

### ⚙️ Advanced Features

- **Always On Top**: Keep LEO visible over your IDE or presentation
- **Transparency Toggle**: For overlay presentations
- **Undo/Redo**: Full undo/redo support for editing lessons
- **Navigation**: Press anywhere in the plan to jump to that location
- **Auto-Typing Modes**:
   - **Single Key** (default): Press any key to advance one character
   - **Entire Block**: Press a key to auto-type an entire code block at configurable speed (10-200ms)
- **Interaction Tracking**: Log student questions (❓) and help sessions (🤝) for later analysis
- **Special Characters**: Easy insertion of navigation keys, shortcuts, and timing controls
- **Auto-Formatting**: Auto-format code with ✨ button (adds cursor movement symbols)
- **Keystroke Logging**: Automatic session logging for performance analysis
- **Customizable Styling**: Configure colors, fonts, and appearance

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
3. **Remove blocks**: Select a block and press the – button
4. **Save**: File → Save Plan (`Ctrl+S`)

### Running a Lesson

1. **Load a lesson**: File → Load Plan (`Ctrl+O`)
2. **Press START** or press `Ctrl+P` to toggle auto-typing mode
3. **Navigate**:
   - `Ctrl+Left`: Step backward
   - `Ctrl+Right`: Step forward
   - Press on any character to jump to that position
4. **Track interactions**:
   - ❓ button: Log a student question
   - 🤝 button: Log when you provide help
5. **Use the timer** (optional): Press ⏱️ to start a 90-minute timer, use +/- to adjust

### Editing Features

While **not** in auto-typing mode, you can edit your lesson:

1. **Select blocks**: Press any block to select it
2. **Edit content**: Edit text directly in the selected block
3. **Add blocks**: Use + buttons (yellow for comments, white for code)
4. **Remove blocks**: Select a block and press the – button
5. **Format code**: Select a code block and press ✨ to auto-format
6. **Insert special characters**: Use the sidebar buttons to insert navigation keys and shortcuts
7. **Undo/Redo**: Use `Ctrl+Z` / `Ctrl+Shift+Z` to undo or redo changes
8. **Save**: `Ctrl+S` (notice the \* indicator disappears when saved)

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

## 📺 Demo

The TwitterLogoMaker lesson plan was used to create this [video tutorial](https://youtu.be/mwXRhFOxuSQ).

The Emordnilap lesson plan was used during this [live stream](https://www.youtube.com/live/nuuHeNgZDEY).

## ⌨️ Keyboard Shortcuts

### Default Hotkeys

| Action              | Shortcut           |
| ------------------- | ------------------ |
| Toggle Typing Mode  | `Ctrl+P`           |
| Step Backward       | `Ctrl+Left`        |
| Step Forward        | `Ctrl+Right`       |
| Undo                | `Ctrl+Z`           |
| Redo                | `Ctrl+Y`           |
| Always On Top       | `Ctrl+Shift+Space` |
| Toggle Transparency | `Ctrl+Shift+T`     |
| New Plan            | `Ctrl+N`           |
| Save Plan           | `Ctrl+S`           |
| Load Plan           | `Ctrl+O`           |
| Settings            | `Ctrl+,`           |

### Typing Hotkeys

By default, **any letter key (a-z)** advances the cursor when in typing mode.

All hotkeys are customizable via Settings.

## 🎨 Special Characters

LEO includes quick-insert buttons for special characters commonly used in coding demonstrations:

- **Navigation**: ←, →, ↑, ↓, ◄ (Home), ► (End), ▲ (Page Up), ▼ (Page Down)
- **Editing**: ↢ (Backspace), ― (Tab), ↩ (Enter)
- **Shift Navigation**: ⇑ (Shift+Up), ⇓ (Shift+Down), ⇐ (Shift+Left), ⇒ (Shift+Right)
- **Shortcuts**: 💾 (Save: Ctrl+S), 🔁 (Alt+Tab)
- **Special**: ❓ (Question marker for comment blocks), 🕛 (Pause 1000ms during typing)

These symbols are automatically translated to actual keystrokes during auto-typing mode.

## 📁 Lesson File Format

Lessons are stored as JSON files:

```json
[
	{
		"type": "comment",
		"text": "Welcome to the lesson!"
	},
	{
		"type": "comment",
		"text": "❓ What do you think will happen next?"
	},
	{
		"type": "code",
		"text": "function hello() {\n  console.log('Hello, World!');\n}"
	}
]
```

### Block Types

- **`comment`**: Brief explanations for the teacher (not auto-typed)
   - Start with ❓ to create a question block
   - Question blocks are automatically logged when reached during presentation
- **`code`**: Text typed character-by-character (for controlled pacing)
   - Use special symbols (←, →, 💾, 🕛, etc.) to insert keystrokes and pauses

## ⚙️ Configuration

Access settings via File → Settings (`Ctrl+,`).

### Customizable Settings

#### Hotkeys

- Auto-typing trigger keys (default: a-z)
- Toggle active shortcut
- Navigation shortcuts (step backward/forward)
- System shortcuts (always on top, transparency)

#### Auto-Typing Behavior

- **Mode**: Single Key (one character per press) or Entire Block (auto-type whole block)
- **Auto-Run Speed**: Configurable speed slider (10-200ms) when using Entire Block mode

#### Colors

- Comment block colors (normal, active, selected)
- Question comment block color (for blocks starting with ❓)
- Active text color
- Cursor color
- Border colors
- Text color

## 📊 Keystroke Logging & Interaction Tracking

LEO automatically logs all keystrokes and interactions during sessions for analysis:

### What Gets Logged

- **Keystrokes**: All characters typed during the lesson
- **Teacher Questions**: When you reach a question block (❓)
- **Student Questions**: When you press the ❓ button
- **Help Sessions**: When you press the 🤝 button
- **Timestamps**: Exact timing for all events

### Log Details

- Logs saved to `logs/` directory next to your lesson file
- Format: `lessonname_key_presses_TIMESTAMP.json`
- Includes session metadata (start time, lesson name, etc.)

This data can be used to analyze teaching patterns, identify challenging sections, and improve lesson pacing.

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
