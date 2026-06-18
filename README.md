# LEO: Auto-typing Tool for Teaching Coding

**LEO** is a teaching assistant designed for live coding demonstrations, programming tutorials, and technical presentations. It allows instructors to prepare lessons in advance and auto-type them smoothly during presentations, ensuring stress-free demonstrations while maintaining the authentic feel of live coding.

**LEO** was originally developed in [Python](https://github.com/gniziemazity/LEO) and created with the purpose of making coding tutorials. This Electron version adds new features specifically tailored for in-class demos.

To understand the main idea behind **LEO**, please check the [Video Tutorial](https://youtu.be/hHYjqfI19r0) and read the [Paper](https://dl.acm.org/doi/10.1145/3769994.3770055).

## ✨ Features

### 🎯 Core Features

- **Auto-Typing Blocks**: Press any hotkey to advance through pre-written code character by character
- **Comment Blocks**: Brief explanations for the teacher
- **Visual Progress**: Real-time progress bar and cursor highlighting
- **Timer Integration**: Presentation timer with adjustable duration
- **Remote Viewing**: Mobile client viewer via WebSocket connection

### 💬 Special Block Types

Comment blocks can be given special roles by starting their text with a specific emoji:

| Prefix | Type        | Behavior                    |
| ------ | ----------- | --------------------------- |
| ❓     | Question    | Opens a question window     |
| 🖼️     | Image       | Opens a image window        |
| 🌐     | Web         | Opens a web viewer window   |
| 📋     | Code Insert | Logs code from copy paste   |
| ➡️     | Move To     | Informs a move is necessary |

### 🪟 Floating Windows

When a special comment block is reached, LEO opens a dedicated window:

- **Question**: Displays the question and student who answered
- **Image**: Shows an image file
- **Web**: Displays a URL inside an embedded web viewer

### 👨‍🎓 Student Management

- Load a class from `students.csv`
- Student names appear as answer buttons on the remote
- When a student answers, **fireworks appear** and the event is logged

### ⚙️ Advanced Features

- **Always On Top**: Keep LEO visible over your IDE or presentation (`Ctrl+Shift+Space`)
- **Transparency Toggle**: For overlay presentations (`Ctrl+Shift+T`)
- **Undo/Redo**: Full undo/redo support for editing lessons
- **Navigation**: Click any character to jump directly to that position
- **Step Navigation**: `Ctrl+Left` / `Ctrl+Right` to step backward or forward one block
- **Auto-Typing Modes**:
   - **Single Key** (default): Press a hotkey to advance one character
   - **Entire Block**: Press a hotkey to auto-type an entire block
- **Interaction Tracking**: Log student questions (🙋) and help sessions (🤝)
- **Special Characters**: Easy insertion of navigation keys and shortcuts
- **Auto-Formatting**: Auto-format code with ✨ (still work in progress...)
- **Keystroke Logging**: Automatic session logging saved to `logs/`
- **Lesson Tools**: Tools for session analysis, animated replay and student comparison
- **Customizable Styling**: Configure colors, fonts, and appearance

## 📋 Prerequisites

- **Node.js** (v20 or higher)
- **npm**

## 🚀 Installation

```bash
# Clone the repository
git clone https://github.com/gniziemazity/LEO-js.git
cd LEO-js

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
   - **White +** button: Add code block (for auto-typing)
3. **Remove blocks**: Select a block and press the – button
4. **Save**: File → Save Plan (`Ctrl+S`)

### Running a Lesson

1. **Load a lesson**: File → Load Plan (`Ctrl+O`)
2. **Press START** or press `Ctrl+P` to toggle auto-typing mode
3. **Navigate**:
   - `Ctrl+Left`: Step backward
   - `Ctrl+Right`: Step forward
   - Click on any character to jump to that position
4. **Track interactions** (buttons on the mobile remote):
   - 🙋 button: Log a student question
   - 🤝 button: Log when you provide help
5. **Use the timer**: Press ⏱️ to start a 90-minute timer, use +/- to adjust

### Editing Features

While **not** in auto-typing mode, you can edit your lesson:

1. **Select blocks**: Click any block to select it
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
2. Click the QR button in the toolbar to display the connection QR code
3. Scan the QR code or visit the URL shown on your mobile device
4. The mobile viewer syncs automatically with your presentation

The remote client supports two interaction modes:

- **Mouse Mode**: Touchpad-style cursor and click control
- **Keyboard Mode**: On-screen keyboard input

### Lesson Tools (browser analysis tools)

LEO ships five browser-based analysis tools in the `lesson_tools/` directory. They
are reached from the running app's **Tools** menu (served by a small local helper on
port 7891) or from the published web overview (`npm run web`). Only the overview has
its own npm launcher; the others open from within the app or by linking from the
overview/students tables.

| Tool              | How to open                         | Description                                                                                                        |
| ----------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 📈 Overview       | `npm run overview` (or Tools menu)  | Merges per-lesson/assignment remarks into `overview.json` + `grades_stats.json`, opens the multi-student dashboard |
| 👥 Students       | app Tools menu                      | Per-student submission viewer with an inline differentiator                                                        |
| 🔍 Differentiator | from Overview / Students / Timeline | Side-by-side teacher/student code comparison                                                                       |
| 📊 Timeline       | app Tools menu                      | Keylog charts and session analysis                                                                                 |
| 📋 Simulator      | app Tools menu                      | Animated keystroke-log replay with live preview                                                                    |

See `lesson_tools/CLAUDE.md` for the grading pipeline and the full `npm run` command list
(`main`, `main-all`, `web`, `eval`, `overview`).

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
| Redo                | `Ctrl+Shift+Z`     |
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
- **Editing**: ⌫ (Backspace), ― (Tab), ↩ (Enter)
- **Shift Navigation**: ⇑ (Shift+Up), ⇓ (Shift+Down), ⇐ (Shift+Left), ⇒ (Shift+Right)
- **Shortcuts**: 💾 (Save: Ctrl+S), 🔁 (Alt+Tab)
- **Timing**: 🕛 (Pause 500ms during typing)
- **Block Markers**: ❓ (Question block), 🖼️ (Image block), 🌐 (Web block), 📋 (Code insert), ➡️ (Move to)

These symbols are automatically translated to actual keystrokes during auto-typing mode.

### Block Types

- **`comment`**: Brief explanations for the teacher (not auto-typed)
   - Start with ❓ to create a **question block** — logged automatically when reached; shows student buttons
   - Start with 🖼️ to create an **image block** — opens a floating image window
   - Start with 🌐 to create a **web block** — opens a floating web viewer
   - Start with 📋 to create a **code insert block**
   - Start with ➡️ to create a **move-to block**
- **`code`**: Text typed character-by-character (for controlled pacing)
   - Use special symbols (←, →, 💾, 🕛, etc.) to insert keystrokes and pauses

## 👥 Students

Student answer buttons in the question window come from the open **course's** roster. Add students via **File → Add Students…**: paste one name per line and LEO writes a sorted `students.csv` to the course root, with the columns:

```
Student ID;Student Name;Student Number;Alter Ego
```

(one random alter ego assigned per student). The roster loads automatically whenever a lesson from that course is opened. Lessons opened outside a course have no student buttons.

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
- Question/Image/Web/Code-Insert block colors
- Active text color
- Cursor color
- Border colors
- Text color

## 📊 Keystroke Logging & Interaction Tracking

LEO automatically logs all keystrokes and interactions during sessions for analysis:

### What Gets Logged

- **Keystrokes**: All characters typed during the lesson
- **Teacher Questions**: When you reach a question block (❓)
- **Student Answers**: Which student answered and when
- **Student Questions**: When you tap the ❓ button on the mobile remote
- **Help Sessions**: When you tap the 🤝 button on the mobile remote
- **Timestamps**: Exact timing for all events

### Log Details

- Logs saved to `logs/` directory next to your lesson file
- Format: `lessonname_key_presses_TIMESTAMP.json`
- Includes session metadata (start time, lesson name, etc.)

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
