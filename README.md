# LEO: Auto-typing Tool for Teaching Coding

**LEO** is a teaching assistant designed for live coding demonstrations, programming tutorials, and technical presentations. It allows teachers to prepare lessons in advance and auto-type them smoothly during presentations, ensuring stress-free demonstrations while maintaining the authentic feel of live coding.

**LEO** was originally developed in [Python](https://github.com/gniziemazity/LEO) and created with the purpose of making coding tutorials. This Electron version adds new features specifically tailored for in-class demos.

To understand the main idea behind **LEO**, please check the [Video Tutorial](https://youtu.be/hHYjqfI19r0) and read the [Paper](https://dl.acm.org/doi/10.1145/3769994.3770055).

## ✨ Features

### 🎯 Core Features

- **Code Blocks**: Press any hotkey to advance through pre-written code character by character
- **Support Blocks**: Everything around the auto-typing — reminders, questions, images, snippets
- **Visual Progress**: Real-time progress bar and cursor highlighting
- **Timer Integration**: Presentation timer with adjustable duration
- **Remote Control**: Control your presentation from your phone via WebSocket

### 💬 Support Blocks

A lesson is made of **code blocks**, which LEO types out for you, and **support
blocks**, which are everything around that auto-typing: what to say, what to ask,
what to show, and where to go next.

Every block shows its kind as its leading symbol, which is a picker (▾ on hover) and is how
you change it — including between code and any support kind, in both directions
(it adds or removes the emoji prefix for you):

| Prefix | Kind         | Behavior                   |
| ------ | ------------ | -------------------------- |
| (none) | Note         | Pauses and shows the note  |
| ⌨      | Code         | LEO types it out           |
| ❓     | Question     | Opens a question window    |
| 🖼️     | Image        | Opens an image window      |
| 🌐     | Web page     | Opens a web viewer window  |
| 📋     | Code snippet | Holds code ready to paste  |
| ➡️     | Go to        | Says where the cursor goes |

### 🪟 Floating Windows

When one of these support blocks is reached, LEO opens a dedicated window:

- **Question**: Displays the question and student who answered
- **Image**: Shows an image file
- **Web**: Displays a URL inside an embedded web viewer

Notes, images and web pages pause the auto-typing the way questions, go-tos and
code snippets do: a popup shows on your phone and in LEO's window until you press
**OK** (or `Ctrl+Enter`). A note shows its text. An image or web page shows what is on screen and a **📌 Pin**
button: a pinned window stays up after you move on, and a 📌 appears next to the
mouse and keyboard buttons on the phone; tap it to unpin. A window whose block is
already behind you then closes; one whose block is still current stays.

`Ctrl+Enter` does a popup's main job. On a code snippet it pastes into the
editor you are in and carries on (the phone's **Paste** does the same, so the
snippet popup has no separate OK). On a go-to that creates a file it starts
typing the file name, as **Type name** does. A go-to into a file you have
already typed in shows that file's code, with the cursor where you left it.

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
- **Hotkey Behavior**:
   - **Single Key** (default): Press a hotkey to advance one character
   - **Auto-Run**: Press a hotkey to type the rest of the block at a fixed speed
- **Interaction Tracking**: Log improvised questions (❓) and help sessions (🤝)
- **Special Characters**: Easy insertion of navigation keys and shortcuts
- **Auto-Formatting**: Auto-format code with ✨ (still work in progress...)
- **Keylog**: Every session is logged to `logs/`
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

### Creating a Plan

1. **Launch LEO** and go to File → New Plan (`Ctrl+N`)
2. **Add blocks**: point at a block. The buttons along its top edge add a block
   of any type above it, the ones along its bottom edge add one below it; the
   last block's bottom row adds at the end
3. **Change a block's type**: use the picker that is the block's leading symbol —
   it is always there, and it turns code into a note (or a snippet, question, …) and
   back
4. **Remove blocks**: point at a block and press ✕ at the middle of its right
   edge
5. **Save**: File → Save Plan (`Ctrl+S`)

### Starting from Existing Code

A lesson that picks up where another one ended does not type that code again.
Put the starting code in a folder named after the plan with `_start` appended,
beside it:

```
part_3.leo
part_3_start/
  index.html
  renderer.js
```

Opening `part_3.leo` then shows a **▸ Starting Code (2 files)** row (click it to
show or fold the files), followed by
every file in the folder (subfolders included; `node_modules`, `.git` and
binary files are left out). Their code cannot be changed from LEO, only their
anchors: click a file to open it, put the caret where the lesson will need to
jump to and press the ⚓ key; Backspace over an anchor removes it. The plan
saves only those anchor positions (line and column per file), never
the code, so editing the files in the folder updates the start. A plan with no
folder of its name has no start row.

### Running a Lesson

1. **Load a plan**: File → Load Plan (`Ctrl+O`)
2. **Press ▶︎** (Start auto-typing) or `Ctrl+P` to start auto-typing
3. **Navigate**:
   - `Ctrl+Left`: Step backward
   - `Ctrl+Right`: Step forward
   - Click on any character to jump to that position
4. **Track interactions** (buttons on the remote):
   - ❓ button: Log a question, asked by you or by a student
   - 🤝 button: Log when you provide help
5. **Use the timer**: Press ⏱️ to start a 90-minute timer, use +/- to adjust

### Editing Features

While auto-typing is **off**, you can edit your plan:

1. **Select blocks**: Click any block to select it
2. **Edit content**: Edit text directly in the selected block
3. **Add blocks**: point at a block and use the + buttons on the edge you want
   the new block on — top adds above, bottom adds below
4. **Reorder or remove**: ▲ sits on the top edge, ▼ on the bottom, ✕ in between;
   one click each, with no need to select the block first
5. **Format code**: select a code block and press ✨ to auto-format
6. **Insert special characters**: Use the sidebar buttons to insert navigation keys and shortcuts
7. **Undo/Redo**: Use `Ctrl+Z` / `Ctrl+Shift+Z` to undo or redo changes
8. **Save**: `Ctrl+S` (notice the \* indicator disappears when saved)

### VS Code Setup (Optional)

If you don't have a preferred code editor, I recommend [VS Code](https://code.visualstudio.com)
It comes with advanced features that help experienced coders. These (may) interfere with LEO plans.
You can disable them by loading the VS Code settings provided in the settings folder.

**How to Apply Settings**:

1. Open VS Code.
2. Press `Ctrl + Shift + P`.
3. Search for **"Open User Settings (JSON)"**.
4. Paste the contents of the desired JSON file into the settings and save.

### Remote Control

Use your phone as a wireless remote to control LEO from across the room.

1. Start LEO on your computer
2. Click the QR button in the toolbar to display the connection QR code
3. Scan the QR code with your phone to open the remote in your phone's browser
4. The remote syncs automatically with your presentation

The remote supports two input modes:

- **Mouse Mode**: Touchpad-style cursor and click control
- **Keyboard Mode**: On-screen keyboard input

### Lesson Tools (browser analysis tools)

LEO ships five browser-based analysis tools in the `lesson_tools/` directory. They
are reached from the running app's **Tools** menu (served by a small local helper on
port 7891) or from the published web overview (`npm run web`). Only the overview has
its own npm launcher; the others open from within the app or by linking from the
overview/students tables.

| Tool              | How to open                         | Description                                                                                                       |
| ----------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 📈 Overview       | `npm run overview` (or Tools menu)  | Merges per-lesson/assignment remarks into `overview.json` + `grades_stats.json`, opens the multi-student overview |
| 👥 Students       | app Tools menu                      | Per-student submission viewer with an inline differentiator                                                       |
| 🔍 Differentiator | from Overview / Students / Timeline | Side-by-side teacher/student code comparison                                                                      |
| 📊 Timeline       | app Tools menu                      | Keylog charts and session analysis                                                                                |
| 📋 Simulator      | app Tools menu                      | Animated keylog replay with live preview                                                                          |

The grading pipeline runs through the `npm run` scripts `main`, `main-all`, `web`, `eval`
and `overview`.

## 📺 Demo

The TwitterLogoMaker plan was used to create this [video tutorial](https://youtu.be/mwXRhFOxuSQ).

The Emordnilap plan was used during this [live stream](https://www.youtube.com/live/nuuHeNgZDEY).

## ⌨️ Keyboard Shortcuts

### Default Hotkeys

| Action              | Shortcut           |
| ------------------- | ------------------ |
| Toggle Auto-typing  | `Ctrl+P`           |
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

### Auto-typing Hotkeys

By default, **any letter key (a-z)** advances the cursor while auto-typing is on.

All hotkeys are customizable via Settings.

## 🎨 Special Characters

LEO includes quick-insert buttons for special characters commonly used in coding demonstrations:

- **Navigation**: ←, →, ↑, ↓, ◄ (Home), ► (End), ▲ (Page Up), ▼ (Page Down)
- **Editing**: ⌫ (Backspace), ⛔ (Delete Line), ― (Tab), ↩ (Enter)
- **Shift Navigation**: ⇑ (Shift+Up), ⇓ (Shift+Down), ⇐ (Shift+Left), ⇒ (Shift+Right)
- **Shortcuts**: 💾 (Save: Ctrl+S), 🔁 (Alt+Tab)
- **Timing**: 🕛 (Pause 500ms during auto-typing)
- **Block Markers**: ❓ (Question), 🖼️ (Image), 🌐 (Web page), 📋 (Code snippet), ➡️ (Go to)

These symbols are automatically translated to actual keystrokes while auto-typing is on.

### Block Types

- **Support blocks** — everything LEO does not type. A plain one is a
  **Note**: brief reminders for the teacher. Give it a prefix, or use the ▾
  picker, to make it one of:
   - ❓ **Question** — logged automatically when reached; shows student buttons
   - 🖼️ **Image** — opens a floating image window
   - 🌐 **Web page** — opens a floating web viewer
   - 📋 **Code snippet** — holds code on the clipboard, ready to paste
   - ➡️ **Go to** — asks you to put the editor cursor somewhere
- **Code**: text typed character-by-character (for controlled pacing)
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

- Auto-typing hotkeys (default: a-z)
- Toggle auto-typing shortcut
- Navigation shortcuts (step backward/forward)
- System shortcuts (always on top, transparency)

#### Hotkey Behavior

- **Mode**: Single Key (one character per press) or Auto-Run (one press types the rest of the block)
- **Auto-Run Speed**: Configurable speed slider (10-200ms) when using Auto-Run mode

#### Colors

- Code, note, question, image / web, code snippet and go-to block colors, and
  the go-to text color
- Active block (background and text) and selected block colors
- Cursor color
- Selected border color
- Text color

## 📊 Keylog & Interaction Tracking

LEO automatically logs all keystrokes and interactions during sessions for analysis:

### What Gets Logged

- **Keystrokes**: All characters typed during the lesson
- **Teacher Questions**: When you reach a question block (❓)
- **Student Answers**: Which student answered and when
- **Improvised Questions**: When you tap the ❓ button on the remote
- **Help Sessions**: When you tap the 🤝 button on the remote
- **Timestamps**: Exact timing for all events

### Log Details

- Logs saved to `logs/` directory next to your plan
- Format: `lessonname_key_presses_TIMESTAMP.log` (JSON), written through a
  `.log.jsonl` journal that is recovered after a crash
- Includes session metadata (start time, lesson name, etc.)

## 🐛 Troubleshooting

### Hotkeys Not Working

- Check if another application is using the same hotkeys
- Try customizing hotkeys in Settings

### Remote Not Connecting

- Ensure firewall allows connections on port 8080
- Check that devices are on the same network

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with [Electron](https://www.electronjs.org/)
- Keyboard automation powered by [@computer-use/nut-js](https://www.npmjs.com/package/@computer-use/nut-js)
- WebSocket server using [ws](https://github.com/websockets/ws)
- Developed with the help of large language models, primarily [Claude](https://claude.com/claude-code) by Anthropic
