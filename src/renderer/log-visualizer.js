/**
 * renderer/log-visualizer.js
 *
 * JavaScript port of log_vis.py.
 * ── SYNC NOTE ──────────────────────────────────────────────────────────────
 * This file and log_vis.py implement the same logic.  When you change one,
 * mirror the change in the other.  Shared concepts to keep aligned:
 *   • ANCHOR_RE, MAX_REAL_DELAY, DELAY_CODE, DELAY_OPS
 *   • CURSOR_MOVES / SHIFT_CURSOR_MOVES key symbols
 *   • CHAR_REPLACEMENTS, DELETE_LINE_CHAR, DELETE_FWRD_CHAR, IGNORED_CHARS
 *   • PAUSE_CHAR / PAUSE_MS
 *   • HTML_VOID_TAGS (for auto-close logic)
 *   • _expand_events() micro-step tuple layout
 *   • VSCodeSettings auto-close rules
 *   • Highlighter colour constants and regex patterns
 * ───────────────────────────────────────────────────────────────────────────
 */

'use strict';

const { ipcRenderer } = require('electron');
const path = require('path');
const fs   = require('fs');

// ─── Constants ────────────────────────────────────────────────────────────────
const ANCHOR_RE      = /⚓([^⚓]*)⚓/g;
const MAX_REAL_DELAY = 3000;
const DELAY_CODE     = 30;
const DELAY_OPS      = 15;

// cursor-move symbols → [deltaLine, deltaCol] or special string
const CURSOR_MOVES = {
    '←': [0, -1], '→': [0, +1],
    '↑': [-1, 0], '↓': [+1, 0],
    '◄': 'linestart', '►': 'lineend',
};
const SHIFT_CURSOR_MOVES = {
    '⇑': [-1, 0], '⇓': [+1, 0],
    '⇐': 'linestart', '⇒': 'lineend',
};

const CHAR_REPLACEMENTS = { '↩': '\n', '\n': '\n', '―': '\t', '\t': '\t' };
const DELETE_LINE_CHAR  = '⛔';
const DELETE_FWRD_CHAR  = '↣';
const IGNORED_CHARS     = new Set(['💾','🔁','Ö','ö','Ș','ñ','ω','Ț','é','🅴','▲','▼']);
const PAUSE_CHAR        = '🕛';
const PAUSE_MS          = 500;

const HTML_VOID_TAGS = new Set([
    'area','base','br','col','embed','hr','img','input',
    'link','meta','param','source','track','wbr',
]);

const CLR = {
    bg:'#ffffff',   sidebar:'#f3f3f3', toolbar:'#e8e8e8', fg:'#1e1e1e',
    cursor:'#000000', select:'#add6ff', blue:'#0000ff',  purple:'#af00db',
    orange:'#795e26', yellow:'#795e26', move:'#e07020',  green:'#267f99',
    red:'#d40000',  pink:'#d40000',   comment:'#008000', accent:'#007acc',
    dim:'#717171',  muted:'#999999',   devbg:'#f5f5f5',  devborder:'#007acc',
    settingsbg:'#f0f0f8',
};

// ─── Text state ───────────────────────────────────────────────────────────────
class TextState {
    constructor() { this.reset(); }

    reset() {
        this.text     = '';
        this.cursor   = 0;          // integer character index
        this.anchors  = {};         // name → cursor position
        this.charTs   = [];         // timestamp per character
        this.selAnchor = null;      // shift-selection anchor
    }

    insert(ch, ts) {
        this.text = this.text.slice(0, this.cursor) + ch + this.text.slice(this.cursor);
        this.charTs.splice(this.cursor, 0, ts);
        this.cursor++;
    }

    deleteBack(n = 1) {
        if (this.cursor < n) return;
        this.text = this.text.slice(0, this.cursor - n) + this.text.slice(this.cursor);
        this.charTs.splice(this.cursor - n, n);
        this.cursor -= n;
    }

    deleteForward(n = 1) {
        if (this.cursor + n > this.text.length) return;
        this.text = this.text.slice(0, this.cursor) + this.text.slice(this.cursor + n);
        this.charTs.splice(this.cursor, n);
    }

    deleteLine() {
        const ls  = this.text.lastIndexOf('\n', this.cursor - 1) + 1;
        const raw = this.text.indexOf('\n', this.cursor);
        const le  = raw === -1 ? this.text.length : raw;
        // include trailing newline if present
        const end = raw === -1 ? le : le + 1;
        const len = end - ls;
        this.text = this.text.slice(0, ls) + this.text.slice(end);
        this.charTs.splice(ls, len);
        this.cursor = ls;
    }

    moveCursor(dir) {
        if (dir === 'linestart') {
            this.cursor = this.text.lastIndexOf('\n', this.cursor - 1) + 1;
        } else if (dir === 'lineend') {
            const e = this.text.indexOf('\n', this.cursor);
            this.cursor = e === -1 ? this.text.length : e;
        } else {
            const [dl, dc] = dir;
            if (dl === 0) {
                this.cursor = Math.max(0, Math.min(this.text.length, this.cursor + dc));
            } else {
                this.cursor = _moveByLines(this.text, this.cursor, dl);
            }
        }
        this.cursor = Math.max(0, Math.min(this.text.length, this.cursor));
    }

    setAnchor(name) { this.anchors[name] = this.cursor; }

    jumpToAnchor(name) {
        if (name in this.anchors) { this.cursor = this.anchors[name]; return true; }
        return false;
    }

    tsAtCursor() {
        const i = Math.min(this.cursor, this.charTs.length - 1);
        return i >= 0 ? this.charTs[i] : null;
    }
}

function _moveByLines(text, pos, delta) {
    const before   = text.slice(0, pos);
    const lineStart = before.lastIndexOf('\n') + 1;
    const col       = pos - lineStart;
    const lineIdx   = (before.match(/\n/g) || []).length;
    const lines     = text.split('\n');
    const target    = Math.max(0, Math.min(lines.length - 1, lineIdx + delta));
    let offset = 0;
    for (let i = 0; i < target; i++) offset += lines[i].length + 1;
    return offset + Math.min(col, lines[target].length);
}

// ─── VSCodeSettings ───────────────────────────────────────────────────────────
const VSCODE_DEFAULTS = {
    'editor.autoClosingBrackets': 'never',
    'editor.autoClosingQuotes':   'never',
    'html.autoClosingTags':       false,
    'html.autoCreateQuotes':      false,
};
const BRACKET_PAIRS = { '(':')', '[':']', '{':'}' };
const QUOTE_PAIRS   = { '"':'"', "'":"'", '`':'`' };

class VSCodeSettings {
    constructor(raw = {}, source = 'defaults') {
        this.raw    = { ...VSCODE_DEFAULTS, ...raw };
        this.source = source;
    }

    static _parseJsonc(text) {
        // strip /* */ comments
        text = text.replace(/\/\*[\s\S]*?\*\//g, '');
        // strip // comments (outside strings)
        let result = '', inStr = false, escape = false;
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (escape) { result += ch; escape = false; continue; }
            if (ch === '\\' && inStr) { result += ch; escape = true; continue; }
            if (ch === '"') { inStr = !inStr; result += ch; continue; }
            if (!inStr && ch === '/' && text[i+1] === '/') {
                while (i < text.length && text[i] !== '\n') i++;
                continue;
            }
            result += ch;
        }
        // strip trailing commas
        result = result.replace(/,(\s*[}\]])/g, '$1');
        return JSON.parse(result);
    }

    static load(logPath) {
        const folder    = path.dirname(path.resolve(logPath));
        const candidate = path.join(folder, '.vscode', 'settings.json');
        if (fs.existsSync(candidate)) {
            try {
                const raw = VSCodeSettings._parseJsonc(fs.readFileSync(candidate, 'utf8'));
                return new VSCodeSettings(raw, candidate);
            } catch (e) {
                return new VSCodeSettings({}, `parse error: ${e.message}`);
            }
        }
        return new VSCodeSettings({}, 'defaults');
    }

    _closingMode(key) {
        const v = this.raw[key];
        if (typeof v === 'boolean') return v ? 'always' : 'never';
        return String(v).toLowerCase();
    }

    _shouldClose(mode, textAfter) {
        if (mode === 'never')  return false;
        if (mode === 'always') return true;
        if (mode === 'languagedefined' || mode === 'beforewhitespace')
            return !textAfter || ' \t\n\r)]}>"\'' .includes(textAfter[0]);
        return false;
    }

    autoCloseBracket(ch, textAfter) {
        const closing = BRACKET_PAIRS[ch];
        if (!closing) return null;
        const mode = this._closingMode('editor.autoClosingBrackets');
        if (textAfter && textAfter[0] === closing) return null;
        return this._shouldClose(mode, textAfter) ? closing : null;
    }

    autoCloseQuote(ch, textBefore, textAfter) {
        if (!(ch in QUOTE_PAIRS)) return null;
        const closing = QUOTE_PAIRS[ch];
        const mode    = this._closingMode('editor.autoClosingQuotes');
        if (textAfter && textAfter[0] === closing) return null;
        if ((textBefore.split(ch).length - 1) % 2 === 1) return null;
        return this._shouldClose(mode, textAfter) ? closing : null;
    }

    autoCloseHtmlTag(ch, textBefore) {
        if (ch !== '>') return null;
        if (!this.raw['html.autoClosingTags']) return null;
        const m = textBefore.match(/<([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^<>]*)?$/);
        if (!m) return null;
        if (HTML_VOID_TAGS.has(m[1].toLowerCase())) return null;
        if (textBefore.lastIndexOf('</') > textBefore.lastIndexOf('<' + m[1])) return null;
        return `</${m[1]}>`;
    }

    autoCreateQuotes(ch, textBefore) {
        if (ch !== '=') return null;
        if (!this.raw['html.autoCreateQuotes']) return null;
        const lt = textBefore.lastIndexOf('<'), gt = textBefore.lastIndexOf('>');
        if (lt <= gt) return null;
        const tag = textBefore.slice(lt);
        if (tag.startsWith('<!') || tag.startsWith('</')) return null;
        return '""';
    }
}

// ─── Syntax Highlighter ───────────────────────────────────────────────────────
// Builds an array of {start, end, cls} spans over the text.
const HL_COLORS = {
    hl_comment:  '#008000', hl_doctype: '#0000ff', hl_tag:     '#800000',
    hl_attr:     '#ff0000', hl_value:   '#0000ff', hl_keyword: '#0000ff',
    hl_builtin:  '#267f99', hl_number:  '#098658', hl_string:  '#a31515',
    hl_func:     '#795e26', hl_css_sel: '#800000', hl_css_prop:'#ff0000',
    hl_css_num:  '#098658', hl_css_at:  '#af00db',
};
const HL_PRIORITY = [
    'hl_attr','hl_css_prop','hl_func','hl_builtin','hl_css_sel','hl_tag',
    'hl_doctype','hl_keyword','hl_number','hl_css_num','hl_css_at',
    'hl_string','hl_value','hl_comment',
];

const JS_KW = new Set([
    'var','let','const','function','return','if','else','for','while','do',
    'switch','case','break','continue','new','this','typeof','instanceof',
    'null','undefined','true','false','class','extends','import','export',
    'default','try','catch','finally','throw','async','await','of','in',
    'from','static','super','yield','delete','void','debugger',
]);
const JS_BUILTINS = new Set([
    'console','document','window','Array','Object','String','Number',
    'Boolean','Math','JSON','Promise','setTimeout','setInterval',
    'clearTimeout','clearInterval','parseInt','parseFloat','isNaN',
    'isFinite','alert','confirm','prompt','addEventListener','fetch',
    'querySelector','querySelectorAll','getElementById',
    'getElementsByClassName','getElementsByTagName',
]);

function buildHighlightSpans(content) {
    const spans = {}; // key → [{start,end}]
    for (const k of Object.keys(HL_COLORS)) spans[k] = [];

    const styleRegions  = [];
    const scriptRegions = [];
    for (const m of content.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi))
        styleRegions.push([m.index + m[0].indexOf(m[1]), m.index + m[0].indexOf(m[1]) + m[1].length]);
    for (const m of content.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))
        scriptRegions.push([m.index + m[0].indexOf(m[1]), m.index + m[0].indexOf(m[1]) + m[1].length]);

    const mask = new Uint8Array(content.length); // 0=html 1=css 2=js
    for (const [s,e] of styleRegions)  mask.fill(1, s, e);
    for (const [s,e] of scriptRegions) mask.fill(2, s, e);

    // HTML
    for (const m of content.matchAll(/<!--[\s\S]*?-->/g))
        if (mask[m.index] === 0) spans.hl_comment.push({start:m.index,end:m.index+m[0].length});
    for (const m of content.matchAll(/<!DOCTYPE\b[^>]*>/gi))
        if (mask[m.index] === 0) spans.hl_doctype.push({start:m.index,end:m.index+m[0].length});
    for (const m of content.matchAll(/="([^"]*)"/g))
        if (mask[m.index] === 0) spans.hl_value.push({start:m.index+2,end:m.index+2+m[1].length});
    for (const m of content.matchAll(/='([^']*)'/g))
        if (mask[m.index] === 0) spans.hl_value.push({start:m.index+2,end:m.index+2+m[1].length});
    for (const m of content.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9-]*)/g))
        if (mask[m.index] === 0) spans.hl_tag.push({start:m.index+(m[0].length-m[1].length),end:m.index+m[0].length});
    for (const m of content.matchAll(/\b([a-zA-Z][a-zA-Z0-9-:]*)(?=\s*=)/g))
        if (mask[m.index] === 0) spans.hl_attr.push({start:m.index,end:m.index+m[1].length});

    // CSS regions
    for (const [off, end] of styleRegions) {
        const css = content.slice(off, end);
        _hlCss(css, off, spans);
    }
    // JS regions
    for (const [off, end] of scriptRegions) {
        const js = content.slice(off, end);
        _hlJs(js, off, spans);
    }

    // Flatten to priority-ordered list, remove overlaps
    const result = [];
    const used   = new Uint8Array(content.length);
    for (const cls of HL_PRIORITY) {
        for (const {start, end} of spans[cls]) {
            if (end <= start) continue;
            let ok = true;
            for (let i = start; i < end; i++) { if (used[i]) { ok = false; break; } }
            if (ok) { for (let i = start; i < end; i++) used[i] = 1; result.push({start,end,cls}); }
        }
    }
    result.sort((a,b) => a.start - b.start);
    return result;
}

function _protect(protected_, s, e) { for (let i=s;i<e;i++) protected_.add(i); }

function _hlCss(css, off, spans) {
    const p = new Set();
    for (const m of css.matchAll(/\/\*[\s\S]*?\*\//g))
        { spans.hl_comment.push({start:off+m.index,end:off+m.index+m[0].length}); _protect(p,m.index,m.index+m[0].length); }
    for (const m of css.matchAll(/"[^"]*"|'[^']*'/g))
        if (!p.has(m.index)) { spans.hl_string.push({start:off+m.index,end:off+m.index+m[0].length}); _protect(p,m.index,m.index+m[0].length); }
    for (const m of css.matchAll(/@[a-zA-Z-]+/g))
        if (!p.has(m.index)) spans.hl_css_at.push({start:off+m.index,end:off+m.index+m[0].length});
    for (const m of css.matchAll(/(?:^|(?<=[}]))\s*([^{@/][^{@/]*?)(?=\s*\{)/gms))
        if (!p.has(m.index+css.slice(m.index).search(/\S/))) { const s=m.index+m[0].indexOf(m[1]),e=s+m[1].length; if(e>s) spans.hl_css_sel.push({start:off+s,end:off+e}); }
    for (const m of css.matchAll(/(?:^|\{|;)\s*([a-zA-Z-]+)\s*(?=:)/gm))
        if (!p.has(m.index)) spans.hl_css_prop.push({start:off+m.index+(m[0].length-m[1].length),end:off+m.index+m[0].length});
    for (const m of css.matchAll(/-?\b\d+\.?\d*(%|px|em|rem|vh|vw|vmin|vmax|pt|pc|cm|mm|in|ex|ch|deg|rad|turn|s|ms|fr)?/g))
        if (m[0] && !p.has(m.index)) spans.hl_css_num.push({start:off+m.index,end:off+m.index+m[0].length});
}

function _hlJs(js, off, spans) {
    const p = new Set();
    for (const m of js.matchAll(/\/\*[\s\S]*?\*\//g))
        { spans.hl_comment.push({start:off+m.index,end:off+m.index+m[0].length}); _protect(p,m.index,m.index+m[0].length); }
    for (const m of js.matchAll(/\/\/[^\n]*/g))
        if (!p.has(m.index)) { spans.hl_comment.push({start:off+m.index,end:off+m.index+m[0].length}); _protect(p,m.index,m.index+m[0].length); }
    for (const m of js.matchAll(/`(?:[^`\\]|\\.)*`/gs))
        if (!p.has(m.index)) { spans.hl_string.push({start:off+m.index,end:off+m.index+m[0].length}); _protect(p,m.index,m.index+m[0].length); }
    for (const m of js.matchAll(/"(?:[^"\\]|\\.)*"/g))
        if (!p.has(m.index)) { spans.hl_string.push({start:off+m.index,end:off+m.index+m[0].length}); _protect(p,m.index,m.index+m[0].length); }
    for (const m of js.matchAll(/'(?:[^'\\]|\\.)*'/g))
        if (!p.has(m.index)) { spans.hl_string.push({start:off+m.index,end:off+m.index+m[0].length}); _protect(p,m.index,m.index+m[0].length); }
    for (const m of js.matchAll(/\b0x[0-9a-fA-F]+|\b\d+\.?\d*([eE][+-]?\d+)?\b/g))
        if (!p.has(m.index)) spans.hl_number.push({start:off+m.index,end:off+m.index+m[0].length});
    for (const m of js.matchAll(/\b([a-zA-Z_$][a-zA-Z0-9_$]*)(?=\s*\()/g))
        if (!p.has(m.index)) spans.hl_func.push({start:off+m.index,end:off+m.index+m[1].length});
    for (const m of js.matchAll(/\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g)) {
        if (p.has(m.index)) continue;
        const w = m[0];
        if (JS_BUILTINS.has(w)) spans.hl_builtin.push({start:off+m.index,end:off+m.index+w.length});
        else if (JS_KW.has(w))  spans.hl_keyword.push({start:off+m.index,end:off+m.index+w.length});
    }
}

// ─── Event expansion ──────────────────────────────────────────────────────────
function splitCodeWithAnchors(code) {
    const segs = []; let last = 0;
    ANCHOR_RE.lastIndex = 0;
    let m;
    while ((m = ANCHOR_RE.exec(code)) !== null) {
        if (m.index > last) segs.push({kind:'text', val:code.slice(last, m.index)});
        segs.push({kind:'anchor', val:m[0]});
        last = m.index + m[0].length;
    }
    if (last < code.length) segs.push({kind:'text', val:code.slice(last)});
    return segs;
}

function expandEvents(events) {
    const micro = [];
    const n = events.length;
    let currentEditor = 'main';

    for (let i = 0; i < n; i++) {
        const ev  = events[i];
        const ts  = ev.timestamp || 0;
        const nts = i + 1 < n ? events[i+1].timestamp : ts;
        const realDelay = Math.min(Math.max(nts - ts, 1), MAX_REAL_DELAY);

        if ('move_to' in ev) {
            const t = ev.move_to;
            if (t === 'DEV' || t === 'dev')  { currentEditor = 'dev';  micro.push(['switch_editor','dev',ts,DELAY_OPS]); }
            else if (t === 'MAIN'|| t === 'main') { currentEditor = 'main'; micro.push(['switch_editor','main',ts,DELAY_OPS]); }
            else micro.push(['move_anchor', t, ts, realDelay]);
            continue;
        }
        if ('switch_editor' in ev) {
            currentEditor = ev.switch_editor;
            micro.push(['switch_editor', currentEditor, ts, DELAY_OPS]);
            continue;
        }

        const editor = currentEditor;

        if ('char' in ev) {
            micro.push(['char', ev.char, ts, realDelay, editor]);
        } else if ('code_insert' in ev) {
            const segs = splitCodeWithAnchors(ev.code_insert);
            micro.push(['log_code_insert', ev.code_insert.slice(0,60), ts, DELAY_OPS]);
            micro.push(['code_insert_begin', ts, DELAY_OPS]);
            const totalChars = segs.filter(s=>s.kind==='text').reduce((a,s)=>a+s.val.length, 0);
            let charI = 0;
            for (const seg of segs) {
                if (seg.kind === 'text') {
                    for (const ch of seg.val) {
                        charI++;
                        const d = charI === totalChars ? realDelay : DELAY_CODE;
                        micro.push(['code_char', ch, ts, d, editor]);
                    }
                } else {
                    micro.push(['set_anchor', seg.val, ts, DELAY_OPS]);
                }
            }
            micro.push(['code_insert_end', ts, DELAY_OPS]);
        } else if ('code_remove' in ev) {
            micro.push(['code_remove', ev.code_remove, ts, realDelay]);
        } else if ('anchor' in ev) {
            micro.push(['set_anchor', ev.anchor, ts, DELAY_OPS]);
        } else if ('move' in ev) {
            micro.push(['move_anchor', ev.move, ts, realDelay]);
        } else if ('jump_to' in ev) {
            micro.push(['move_anchor', ev.jump_to, ts, realDelay]);
        }
    }
    return micro;
}

// ─── Timestamp formatter ──────────────────────────────────────────────────────
function fmtTs(tsMs) {
    try {
        const d = new Date(tsMs);
        const dd   = String(d.getDate()).padStart(2,'0');
        const mm   = String(d.getMonth()+1).padStart(2,'0');
        const yyyy = d.getFullYear();
        const hh   = String(d.getHours()).padStart(2,'0');
        const min  = String(d.getMinutes()).padStart(2,'0');
        const ss   = String(d.getSeconds()).padStart(2,'0');
        const ms   = String(d.getMilliseconds()).padStart(3,'0');
        return `${dd}.${mm}.${yyyy}  ${hh}:${min}:${ss}.${ms}`;
    } catch { return String(tsMs); }
}

// ─── HTML escaping ────────────────────────────────────────────────────────────
function esc(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─── Render editor content with syntax highlights + cursor mark ───────────────
function renderEditorHtml(textState, cursorVisible = true) {
    const text = textState.text;
    const cur  = textState.cursor;

    // Build highlight spans
    let hlSpans = [];
    try { hlSpans = buildHighlightSpans(text); } catch (_) {}

    const colorAt = new Array(text.length).fill(null);
    for (const {start, end, cls} of hlSpans) {
        const col = HL_COLORS[cls];
        for (let i = start; i < end; i++) colorAt[i] = col;
    }

    let html = '';
    let currentColor = null;

    function closeSpan() { if (currentColor) { html += '</span>'; currentColor = null; } }
    function openSpan(col) {
        if (col !== currentColor) {
            closeSpan();
            html += `<span style="color:${col}">`;
            currentColor = col;
        }
    }

    for (let i = 0; i <= text.length; i++) {
        if (i === cur && cursorVisible) {
            closeSpan();
            html += '<span class="vis-cursor">|</span>';
        }
        if (i === text.length) break;
        const ch  = text[i];
        const col = colorAt[i];
        if (col) openSpan(col); else closeSpan();
        if      (ch === '\n') html += '<br>';
        else if (ch === '\t') html += '    '; // 4 spaces for tabs
        else                  html += esc(ch);
    }
    closeSpan();
    return html;
}

// ─── Log Visualizer ───────────────────────────────────────────────────────────
class LogVisualizer {
    constructor() {
        this.micro      = [];
        this.microIdx   = 0;
        this.playing    = false;
        this.timerId    = null;
        this.speed      = 8.0;
        this._silent    = false;

        this.main = new TextState();
        this.dev  = new TextState();
        this._activeEditor  = 'main';
        this._ciBaseIndent  = '';

        // Log entries: [{microIdx, text, color}]
        this._fullLog    = [];
        this._logMicro   = [];
        this._logBuilt   = false;
        this._logBuf     = [];

        this._microTs = [];   // timestamps for seekbar
        this._seeking = false;
        this._seekWasPlaying = false;
        this._dragFrac  = 0;
        this._dragTimer = null;

        this._stepStartWall = 0;
        this._stepDurS      = 0.001;
        this._seekbarRaf    = null;

        this.vscode = new VSCodeSettings();
        this._selAnchorMain = null;

        // Preview throttle
        this._previewDirty = false;
        this._previewRafId = null;

        this._buildUI();
    }

    // ── UI Construction ───────────────────────────────────────────────────────
    _buildUI() {
        const root = document.getElementById('vis-root');
        root.innerHTML = `
        <div id="vis-left">
          <div id="vis-toolbar">
            <button id="btn-play" disabled>▶  Play</button>
            <button id="btn-reset" disabled>⏮  Reset</button>
            <div class="sep"></div>
            <button id="btn-settings">⚙ VS Code: defaults</button>
            <div class="sep"></div>
            <label>Speed: <input id="speed-slider" type="range" min="1" max="60" value="8" step="0.5"></label>
            <span id="speed-label">8×</span>
            <div class="sep"></div>
            <label><input id="chk-autoscroll" type="checkbox" checked> Auto-scroll</label>
            <span id="ts-label" style="margin-left:auto;color:${CLR.accent};font-family:Consolas,monospace;font-size:12px"></span>
            <span id="prog-label" style="margin-left:12px;color:${CLR.muted};font-size:12px">No file loaded</span>
          </div>
          <div id="vis-seekbar"><div id="vis-seekfill"></div></div>
          <div id="vis-main">
            <div id="vis-editor-wrap">
              <div class="pane-title">Code Output</div>
              <pre id="vis-editor"></pre>
              <div id="vis-dev-outer">
                <div id="vis-dev-title">
                  <span>  DevTools</span>
                  <span id="dev-indicator" style="color:${CLR.dim}">●</span>
                  <button id="btn-dev-toggle">−</button>
                </div>
                <pre id="vis-dev-editor"></pre>
              </div>
            </div>
            <div id="vis-event-log-wrap">
              <div class="pane-title">Event Log</div>
              <div id="vis-event-log"></div>
            </div>
          </div>
          <div id="vis-status">Ready</div>
        </div>
        <div id="vis-right">
          <div class="pane-title" style="display:flex;align-items:center;gap:8px">
            Live Preview
            <button id="btn-refresh-preview" title="Refresh preview">↻</button>
          </div>
          <iframe id="vis-preview" sandbox="allow-scripts allow-same-origin"></iframe>
        </div>
        `;

        this.elPlay      = document.getElementById('btn-play');
        this.elReset     = document.getElementById('btn-reset');
        this.elSettings  = document.getElementById('btn-settings');
        this.elSpeed     = document.getElementById('speed-slider');
        this.elSpeedLbl  = document.getElementById('speed-label');
        this.elAutoScroll= document.getElementById('chk-autoscroll');
        this.elTsLbl     = document.getElementById('ts-label');
        this.elProgLbl   = document.getElementById('prog-label');
        this.elSeekbar   = document.getElementById('vis-seekbar');
        this.elSeekFill  = document.getElementById('vis-seekfill');
        this.elEditor    = document.getElementById('vis-editor');
        this.elDevEditor = document.getElementById('vis-dev-editor');
        this.elDevOuter  = document.getElementById('vis-dev-outer');
        this.elDevInd    = document.getElementById('dev-indicator');
        this.elEventLog  = document.getElementById('vis-event-log');
        this.elStatus    = document.getElementById('vis-status');
        this.elPreview   = document.getElementById('vis-preview');
        this.elDevToggle = document.getElementById('btn-dev-toggle');
        this.elRefresh   = document.getElementById('btn-refresh-preview');

        this._devExpanded = true;

        this.elPlay.onclick   = () => this.togglePlay();
        this.elReset.onclick  = () => this.resetPlayback();
        this.elSettings.onclick = () => this._showSettings();
        this.elRefresh.onclick  = () => this._updatePreview(true);
        this.elDevToggle.onclick = () => this._toggleDevPanel();

        this.elSpeed.addEventListener('input', () => {
            this.speed = parseFloat(this.elSpeed.value);
            this.elSpeedLbl.textContent = `${this.speed.toFixed(0)}×`;
        });

        // Seekbar
        this.elSeekbar.addEventListener('mousedown',  e => this._onSeekPress(e));
        document.addEventListener('mousemove',        e => this._onSeekDrag(e));
        document.addEventListener('mouseup',          e => this._onSeekRelease(e));
    }

    _toggleDevPanel() {
        this._devExpanded = !this._devExpanded;
        this.elDevOuter.classList.toggle('collapsed', !this._devExpanded);
        this.elDevToggle.textContent = this._devExpanded ? '−' : '+';
    }

    // ── File Loading ──────────────────────────────────────────────────────────
    loadFile(filePath) {
        let data;
        try {
            data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (e) {
            this._setStatus(`⚠ Could not load file: ${e.message}`, CLR.red);
            return;
        }
        this.vscode = VSCodeSettings.load(filePath);
        this._updateSettingsBadge();

        const events = data.events || [];
        this.micro    = expandEvents(events);
        this._microTs = this.micro.map(a => {
            switch (a[0]) {
                case 'interaction': return a[3];
                case 'code_insert_begin': case 'code_insert_end': return a[1];
                case 'switch_editor': return a[2];
                default: return a[2];
            }
        });

        this._seekTo(this.micro.length);  // show final state immediately
        this.elPlay.disabled  = false;
        this.elReset.disabled = false;

        const name = filePath.replace(/\\/g,'/').split('/').pop();
        this._setStatus(`  Loaded: ${name}  ·  ${events.length} events → ${this.micro.length} steps`);
    }

    _updateSettingsBadge() {
        const s = this.vscode.source;
        if (s === 'defaults')
            this.elSettings.textContent = '⚙ VS Code: defaults';
        else if (s.startsWith('parse error'))
            this.elSettings.textContent = '⚙ VS Code: error ⚠';
        else
            this.elSettings.textContent = '⚙ VS Code: settings.json ✓';
    }

    // ── Playback ──────────────────────────────────────────────────────────────
    togglePlay() {
        if (this.playing) this._pause();
        else {
            if (this.microIdx >= this.micro.length && this.micro.length) this._seekTo(0);
            this._play();
        }
    }

    _play() {
        this.playing = true;
        this.elPlay.textContent  = '⏸  Pause';
        this.elPlay.style.background = '#9a7000';
        this._setStatus('  ▶  Playing…');
        this._stepStartWall = performance.now();
        this._stepDurS      = 0.001;
        this._scheduleSeekbarUpdate();
        this._schedule(0);
    }

    _pause() {
        this.playing = false;
        if (this.timerId) { clearTimeout(this.timerId); this.timerId = null; }
        if (this._seekbarRaf) { cancelAnimationFrame(this._seekbarRaf); this._seekbarRaf = null; }
        this.elPlay.textContent  = '▶  Play';
        this.elPlay.style.background = '#2d8f2d';
        this._setStatus('  ⏸  Paused');
    }

    resetPlayback() {
        this._pause();
        this.microIdx = 0;
        this.main.reset();
        this.dev.reset();
        this._ciBaseIndent   = '';
        this._activeEditor   = 'main';
        this._selAnchorMain  = null;
        this._logBuilt = false;
        this._fullLog  = [];
        this._logMicro = [];
        this._logBuf   = [];
        this._renderEditors();
        this._clearEventLog();
        this._updateProgress();
        this.elDevInd.style.color = CLR.dim;
        this._setStatus('  ⏮  Reset — press Play to begin');
    }

    _schedule(delayMs) {
        if (this.playing)
            this.timerId = setTimeout(() => this._step(), Math.max(1, delayMs));
    }

    _step() {
        if (!this.playing) return;
        if (this.microIdx >= this.micro.length) {
            this.playing = false;
            this.elPlay.textContent = '▶  Play';
            this.elPlay.style.background = '#2d8f2d';
            this._setStatus('  ✓  Playback complete');
            this._renderEditors();
            this._schedulePreview();
            return;
        }
        const act = this.micro[this.microIdx++];
        const delayBase = this._handle(act);
        this._renderEditors();
        this._schedulePreview();
        this._updateProgress();
        const delayMs = Math.max(1, Math.round(delayBase / Math.max(0.1, this.speed)));
        this._stepStartWall = performance.now();
        this._stepDurS      = delayMs / 1000;
        this._schedule(delayMs);
    }

    // ── Event handler ─────────────────────────────────────────────────────────
    _handle(act) {
        const kind = act[0];

        if (kind === 'switch_editor') {
            const [,target,,delay] = act;
            const label = target === 'dev' ? 'DevTools' : 'Main Editor';
            this._log(act[2], `⇄  switch to ${label}`, CLR.move);
            this._activeEditor = target;
            this.elDevInd.style.color = target === 'dev' ? CLR.devborder : CLR.dim;
            return delay;

        } else if (kind === 'char') {
            const [,ch,ts,delay,editor] = act;
            return this._handleChar(ch, ts, delay, editor);

        } else if (kind === 'code_insert_begin') {
            const lineStart = this.main.text.lastIndexOf('\n', this.main.cursor - 1) + 1;
            const m = this.main.text.slice(lineStart, this.main.cursor).match(/^(\s*)/);
            this._ciBaseIndent = m ? m[1] : '';
            return act[2];

        } else if (kind === 'code_insert_end') {
            this._ciBaseIndent = '';
            return act[2];

        } else if (kind === 'code_char') {
            const [,ch,ts,delay,editor] = act;
            const st = editor === 'dev' ? this.dev : this.main;
            st.insert(ch, ts);
            if (ch === '\n' && editor === 'main' && this._ciBaseIndent) {
                for (const ic of this._ciBaseIndent) this.main.insert(ic, ts);
            }
            if (editor === 'dev') this.elDevInd.style.color = CLR.devborder;
            return delay;

        } else if (kind === 'log_code_insert') {
            const clean = act[1].replace(ANCHOR_RE, '');
            this._log(act[2], `⬇  code_insert: ${JSON.stringify(clean.slice(0,50))}`, CLR.orange);
            return act[3];

        } else if (kind === 'set_anchor') {
            const [,name,ts,delay] = act;
            this.main.setAnchor(name);
            this._log(ts, `⚓  anchor ${name} → ${this.main.cursor}`, CLR.accent);
            return delay;

        } else if (kind === 'move_anchor') {
            const [,name,ts,delay] = act;
            const ok = this.main.jumpToAnchor(name);
            if (ok)  this._log(ts, `→  move to ${name} (pos ${this.main.cursor})`, CLR.move);
            else     this._log(ts, `⚠  unknown anchor: ${name}`, CLR.red);
            return delay;

        } else if (kind === 'code_remove') {
            const [,code,ts,delay] = act;
            const pos = this.main.text.lastIndexOf(code);
            if (pos < 0) {
                this._log(ts, `✗  remove not found: ${JSON.stringify(code.slice(0,40))}`, CLR.red);
            } else {
                this.main.text = this.main.text.slice(0, pos) + this.main.text.slice(pos + code.length);
                this.main.charTs.splice(pos, code.length);
                if (this.main.cursor > pos) this.main.cursor = Math.max(pos, this.main.cursor - code.length);
                this._log(ts, `✂  remove: ${JSON.stringify(code.slice(0,50))}`, CLR.orange);
            }
            return delay;
        }

        return DELAY_OPS;
    }

    _handleChar(ch, ts, delay, editor) {
        const st = editor === 'dev' ? this.dev : this.main;

        // ── cursor moves ─────────────────────────────────────────────────────
        if (ch in CURSOR_MOVES) {
            this.main.moveCursor(CURSOR_MOVES[ch]);
            this._selAnchorMain = null;
            this._log(ts, `⌨  ${ch}`, CLR.blue);
            return delay;
        }
        if (ch in SHIFT_CURSOR_MOVES) {
            if (this._selAnchorMain === null) this._selAnchorMain = this.main.cursor;
            this.main.moveCursor(SHIFT_CURSOR_MOVES[ch]);
            this._log(ts, `⌨  ${ch} (select)`, CLR.blue);
            return delay;
        }

        // ── special chars ────────────────────────────────────────────────────
        if (ch in CHAR_REPLACEMENTS) {
            const real = CHAR_REPLACEMENTS[ch];
            st.insert(real, ts);
            if (real === '\n' && editor === 'main') this._autoIndent(ts);
            this._log(ts, `⌨  ${real === '\n' ? '↩ Enter' : '⇥ Tab'}`, CLR.blue);
            if (editor === 'dev') this.elDevInd.style.color = CLR.devborder;
            return delay;
        }

        if (ch === '↢') {        // backspace
            const CLOSING = ['</style','</script','</html'];
            const nextText = st.text.slice(st.cursor).trimStart();
            const prevChar = st.cursor > 0 ? st.text[st.cursor - 1] : '';
            if ((prevChar === '\n' || prevChar === '') && CLOSING.some(t => nextText.startsWith(t))) {
                this._log(ts, '⌫  Backspace (ignored — before closing tag)', CLR.dim);
                return delay;
            }
            st.deleteBack(1);
            this._log(ts, '⌫  Backspace', CLR.blue);
            return delay;
        }

        if (ch === DELETE_FWRD_CHAR) {
            st.deleteForward(1);
            this._log(ts, '⌦  Delete (forward)', CLR.blue);
            return delay;
        }

        if (ch === DELETE_LINE_CHAR) {
            st.deleteLine();
            this._log(ts, '⛔  Delete Line (Ctrl+Shift+K)', CLR.blue);
            return delay;
        }

        if (ch === PAUSE_CHAR) {
            this._log(ts, '🕛  pause 500 ms', CLR.dim);
            return PAUSE_MS;
        }

        if (IGNORED_CHARS.has(ch)) return DELAY_OPS;

        if (ch === ';' && editor === 'dev') {
            st.insert(ch, ts);
            this._devSemicolonNewline(ts);
            this._log(ts, `⌨  ${JSON.stringify(ch)}`, CLR.dim);
            if (editor === 'dev') this.elDevInd.style.color = CLR.devborder;
            return delay;
        }

        if (editor === 'main') this._autoDedent(ch, ts);
        st.insert(ch, ts);
        if (editor === 'main') this._applyVscodeAuto(ch, ts);
        if (editor === 'dev')  this.elDevInd.style.color = CLR.devborder;

        this._log(ts, `⌨  ${JSON.stringify(ch)}`, CLR.dim);
        return delay;
    }

    // ── VS Code auto-close / auto-indent ──────────────────────────────────────
    _applyVscodeAuto(ch, ts) {
        const textBefore = this.main.text.slice(0, this.main.cursor);
        const textAfter  = this.main.text.slice(this.main.cursor);
        const lineEnd    = textAfter.indexOf('\n');
        const afterLine  = lineEnd === -1 ? textAfter : textAfter.slice(0, lineEnd);

        let auto = this.vscode.autoCreateQuotes(ch, textBefore.slice(0,-1));
        if (auto) { for (const c of auto) this.main.insert(c, ts); this.main.cursor -= auto.length; this._log(ts, `  ↳ auto-quotes: ${JSON.stringify(auto)}`, CLR.green); return; }

        auto = this.vscode.autoCloseHtmlTag(ch, textBefore.slice(0,-1));
        if (auto) { for (const c of auto) this.main.insert(c, ts); this.main.cursor -= auto.length; this._log(ts, `  ↳ auto-tag: ${JSON.stringify(auto)}`, CLR.green); return; }

        auto = this.vscode.autoCloseBracket(ch, afterLine);
        if (auto) { for (const c of auto) this.main.insert(c, ts); this.main.cursor -= auto.length; this._log(ts, `  ↳ auto-bracket: ${JSON.stringify(auto)}`, CLR.green); return; }

        auto = this.vscode.autoCloseQuote(ch, textBefore, afterLine);
        if (auto) { for (const c of auto) this.main.insert(c, ts); this.main.cursor -= auto.length; this._log(ts, `  ↳ auto-quote: ${JSON.stringify(auto)}`, CLR.green); return; }
    }

    _autoIndent(ts) {
        // ── SYNC NOTE: mirrors log_vis.py  _auto_indent ──────────────────
        const cur      = this.main.cursor;
        const prevEnd  = this.main.text.lastIndexOf('\n', cur - 1);  // the \n we just typed
        const prev2    = prevEnd > 0 ? this.main.text.lastIndexOf('\n', prevEnd - 1) : -1;
        const prevLine = this.main.text.slice(prev2 + 1, prevEnd);
        const base     = (prevLine.match(/^(\s*)/) || ['', ''])[1];
        const trimmed  = prevLine.trimEnd();

        // opens = line ends with { ( [ (CSS/JS)
        //         OR a non-void, non-self-closing HTML open tag (matches Python's regex)
        const opensWithBrace = /[{([]$/.test(trimmed);
        const opensWithTag   =
            /<[a-zA-Z][a-zA-Z0-9-]*(\s[^>]*)?>$/.test(trimmed) &&
            !/\/>$/.test(trimmed) &&
            !/<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)(\s[^>]*)?>$/i.test(trimmed);
        const opens  = opensWithBrace || opensWithTag;
        const indent = base + (opens ? '    ' : '');

        const after        = this.main.text.slice(cur);
        const afterTrimmed = after.trimStart();
        const closes       = /^[})\]]/.test(afterTrimmed) || /^<\//.test(afterTrimmed);

        if (opens && closes) {
            for (const c of indent) this.main.insert(c, ts);
            this.main.insert('\n', ts);
            for (const c of base) this.main.insert(c, ts);
            this.main.cursor -= base.length + 1;
        } else {
            for (const c of indent) this.main.insert(c, ts);
        }
    }

    _autoDedent(ch, ts) {
        const lineStart = this.main.text.lastIndexOf('\n', this.main.cursor - 1) + 1;
        const before    = this.main.text.slice(lineStart, this.main.cursor);

        const isCloser   = '})]'.includes(ch);
        const isHtmlEnd  = ch === '/' && /^[ \t]*<$/.test(before);
        if (!(isCloser || isHtmlEnd)) return;
        if (isCloser && !/^[ \t]*$/.test(before)) return;
        if (!before) return;

        let newBefore;
        if (before.startsWith('\t'))      newBefore = before.slice(1);
        else if (before.startsWith('    ')) newBefore = before.slice(4);
        else if (before.startsWith('  '))  newBefore = before.slice(2);
        else return;

        const n = before.length - newBefore.length;
        this.main.text = this.main.text.slice(0, lineStart) + newBefore + this.main.text.slice(this.main.cursor);
        this.main.charTs.splice(lineStart, n);
        this.main.cursor = lineStart + newBefore.length;
    }

    _devSemicolonNewline(ts) {
        const lineStart = this.dev.text.lastIndexOf('\n', this.dev.cursor - 1) + 1;
        const line      = this.dev.text.slice(lineStart, this.dev.cursor);
        const indent    = (line.match(/^(\s*)/) || ['',''])[1];
        this.dev.insert('\n', ts);
        for (const c of indent) this.dev.insert(c, ts);
    }

    // ── Rendering ─────────────────────────────────────────────────────────────
    _renderEditors() {
        this.elEditor.innerHTML    = renderEditorHtml(this.main);
        this.elDevEditor.innerHTML = renderEditorHtml(this.dev);
        if (this.elAutoScroll.checked) {
            const cur = this.elEditor.querySelector('.vis-cursor');
            if (cur) cur.scrollIntoView({block:'nearest'});
        }
        const ts = this.main.tsAtCursor() || this.dev.tsAtCursor();
        if (ts && !this._silent) this.elTsLbl.textContent = fmtTs(ts);
    }

    _schedulePreview() {
        this._previewDirty = true;
        if (!this._previewRafId)
            this._previewRafId = requestAnimationFrame(() => {
                this._previewRafId = null;
                if (this._previewDirty) { this._updatePreview(); this._previewDirty = false; }
            });
    }

    _updatePreview(force = false) {
        // Only refresh preview every ~300 steps while playing for performance,
        // always refresh on seek/force/pause.
        if (!force && this.playing && (this.microIdx % 300 !== 0)) { this._previewDirty = true; return; }
        try {
            const html = this.main.text;
            this.elPreview.srcdoc = html || '';
        } catch (_) {}
        this._previewDirty = false;
    }

    // ── Event log ─────────────────────────────────────────────────────────────
    _log(ts, msg, color = CLR.blue) {
        const tShort = ts ? fmtTs(ts).slice(-12) : '??:??:??.???';
        const text   = `[${tShort}] ${msg}\n`;
        if (this._logBuilt) return;  // clipping handled by _updateLogClip
        if (this._silent)   { this._logBuf.push([this.microIdx, text, color]); return; }
        if (!this._silent)  this._appendLogEntry(text, color);
    }

    _appendLogEntry(text, color) {
        const span = document.createElement('span');
        span.style.color = color;
        span.textContent = text;
        this.elEventLog.appendChild(span);
        this.elEventLog.scrollTop = this.elEventLog.scrollHeight;
    }

    _clearEventLog() { this.elEventLog.innerHTML = ''; }

    _buildFullLogWidget() {
        this._clearEventLog();
        const frag = document.createDocumentFragment();
        this._logChars = [];
        let cum = 0;
        for (const [,text,color] of this._fullLog) {
            const span = document.createElement('span');
            span.className = 'log-entry';
            span.style.color  = color;
            span.textContent  = text;
            span.dataset.cum  = cum;
            frag.appendChild(span);
            cum += text.length;
            this._logChars.push(cum);
        }
        this.elEventLog.appendChild(frag);
        this._logBuilt = true;
    }

    _updateLogClip(targetIdx) {
        if (!this._logBuilt || !this._fullLog.length) return;
        // show entries whose microIdx ≤ targetIdx
        const entries = this.elEventLog.querySelectorAll('.log-entry');
        let lastVisible = null;
        entries.forEach((el, i) => {
            const mi = this._logMicro[i];
            const visible = mi <= targetIdx;
            el.style.display = visible ? '' : 'none';
            if (visible) lastVisible = el;
        });
        if (lastVisible) lastVisible.scrollIntoView({block:'nearest'});
    }

    // ── Seekbar ───────────────────────────────────────────────────────────────
    _drawSeekbar(frac) {
        this.elSeekFill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
    }

    _idxToFrac(idx) { return this.micro.length ? idx / this.micro.length : 0; }
    _fracToIdx(frac) { return Math.max(0, Math.min(this.micro.length, Math.round(frac * this.micro.length))); }

    _scheduleSeekbarUpdate() {
        if (this._seekbarRaf) cancelAnimationFrame(this._seekbarRaf);
        if (!this.playing || this._seeking) return;
        this._seekbarRaf = requestAnimationFrame(() => {
            this._seekbarRaf = null;
            if (!this.playing) return;
            const elapsed = (performance.now() - this._stepStartWall) / 1000;
            const t = this._stepDurS > 0 ? Math.min(1, elapsed / this._stepDurS) : 1;
            const frac = Math.min(1, (this.microIdx + t) / Math.max(1, this.micro.length));
            this._drawSeekbar(frac);
            this._scheduleSeekbarUpdate();
        });
    }

    _onSeekPress(e) {
        if (!this.micro.length) return;
        this._seeking = true;
        this._seekWasPlaying = this.playing;
        if (this.playing) this._pause();
        const frac = e.offsetX / this.elSeekbar.offsetWidth;
        this._drawSeekbar(frac);
    }

    _onSeekDrag(e) {
        if (!this._seeking) return;
        const rect = this.elSeekbar.getBoundingClientRect();
        const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        this._dragFrac = frac;
        this._drawSeekbar(frac);
        if (!this._dragTimer)
            this._dragTimer = setTimeout(() => {
                this._dragTimer = null;
                if (this._seeking) { this._seekTo(this._fracToIdx(this._dragFrac)); this._drawSeekbar(this._dragFrac); }
            }, 150);
    }

    _onSeekRelease(e) {
        if (!this._seeking) return;
        if (this._dragTimer) { clearTimeout(this._dragTimer); this._dragTimer = null; }
        this._seeking = false;
        const rect = this.elSeekbar.getBoundingClientRect();
        const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        this._seekTo(this._fracToIdx(frac));
        if (this._seekWasPlaying) this._play();
    }

    _seekTo(targetIdx) {
        if (!this.micro.length) return;
        targetIdx = Math.max(0, Math.min(targetIdx, this.micro.length));
        this._setStatus('  ⏩  Seeking…', CLR.dim);

        this._silent = true;
        this.microIdx  = 0;
        this.main.reset();
        this.dev.reset();
        this._ciBaseIndent  = '';
        this._activeEditor  = 'main';
        this._selAnchorMain = null;

        while (this.microIdx < targetIdx) {
            this._handle(this.micro[this.microIdx]);
            this.microIdx++;
        }
        this._silent = false;

        if (!this._logBuilt) {
            this._fullLog  = [...this._logBuf];
            this._logMicro = this._fullLog.map(e => e[0]);
            this._logBuf   = [];
            this._buildFullLogWidget();
        }
        this._updateLogClip(targetIdx);
        this._renderEditors();
        this._updatePreview(true);
        this._updateProgress();

        if (!this._seeking) {
            if (targetIdx >= this.micro.length) this._setStatus('  ✓  Playback complete');
            else this._setStatus(`  ⏸  Seeked to ${targetIdx} / ${this.micro.length}`);
        }
    }

    _updateProgress() {
        const t = this.micro.length, i = this.microIdx;
        if (!this._silent) this.elProgLbl.textContent = `${i} / ${t}`;
        if (!this.playing || this._seeking) this._drawSeekbar(this._idxToFrac(i));
    }

    _setStatus(msg, bg = CLR.accent) {
        this.elStatus.textContent = msg;
        this.elStatus.style.background = bg;
    }

    // ── Settings popup ────────────────────────────────────────────────────────
    _showSettings() {
        // A simple modal built inline
        const existing = document.getElementById('settings-modal');
        if (existing) { existing.remove(); return; }

        const modal = document.createElement('div');
        modal.id = 'settings-modal';
        modal.innerHTML = `
        <div id="settings-box">
          <div style="font-weight:bold;font-size:14px;margin-bottom:6px">⚙ VS Code Editor Settings</div>
          <div style="font-size:11px;color:${CLR.muted};margin-bottom:8px">Source: ${this.vscode.source}</div>
          <table id="settings-table"></table>
          <button id="btn-close-settings" style="margin-top:12px">Close</button>
        </div>`;
        document.body.appendChild(modal);

        const tbl = document.getElementById('settings-table');
        const keys = [
            'editor.autoClosingBrackets','editor.autoClosingQuotes',
            'html.autoClosingTags','html.autoCreateQuotes','editor.minimap.enabled',
            'editor.parameterHints.enabled','editor.quickSuggestions',
        ];
        for (const key of keys) {
            const v = this.vscode.raw[key];
            let active, valStr;
            if (typeof v === 'boolean')     { active = v; valStr = v ? 'ON' : 'off'; }
            else if (typeof v === 'object') { active = Object.values(v).some(x => x !== false && x !== 'off'); valStr = active ? 'mixed' : 'off'; }
            else                            { active = !['never','off','false','0'].includes(String(v).toLowerCase()); valStr = String(v); }
            const tr = document.createElement('tr');
            tr.innerHTML = `<td style="color:${active ? CLR.green : CLR.dim}">●</td>
                <td style="font-family:Consolas;font-size:11px">${key}</td>
                <td style="font-family:Consolas;font-size:11px;color:${active ? CLR.orange : CLR.muted};text-align:right;padding-left:12px">${valStr}</td>`;
            tbl.appendChild(tr);
        }
        document.getElementById('btn-close-settings').onclick = () => modal.remove();
        modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    }
}

// ─── Entry point ──────────────────────────────────────────────────────────────
let vis;

document.addEventListener('DOMContentLoaded', () => {
    vis = new LogVisualizer();

    ipcRenderer.on('load-log', (_e, filePath) => {
        vis.loadFile(filePath);
    });
});
