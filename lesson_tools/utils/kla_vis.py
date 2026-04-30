import re
import random
import textwrap
import warnings
from collections import Counter, defaultdict
from datetime import datetime, timedelta

import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import matplotlib.lines as mlines
import matplotlib.patches as mpatches
from matplotlib.gridspec import GridSpec
from matplotlib.offsetbox import AnnotationBbox, TextArea, HPacker, VPacker
from matplotlib.transforms import blended_transform_factory as _blended_tf

from .kla_config import Config
from .kla_data import analyze_typing_blocks, calculate_intervals, extract_interactions

warnings.filterwarnings('ignore', category=UserWarning, module='tkinter')
warnings.filterwarnings('ignore', message='.*tight_layout.*')
warnings.filterwarnings('ignore', message='.*findfont.*')


_COLOR_ANCHOR         = '#007acc'
_COLOR_MOVE           = '#e07020'
_COLOR_TEXT           = '#1e1e1e'
_COLOR_DEV            = '#22aa22'
_COLOR_DELETE         = '#cc0000'
_COLOR_DELETE_IGNORED = '#ffaaaa'
_COLOR_MISSING_TOK    = '#cc3333'
_COLOR_EXTRA_TOK      = '#1565C0'
_DELETE_DISPLAY_SET   = {'\u26d4', '\u232b', '\u2326'}


def _ax_annotate(ax, lbl, xy, xytext, facecolor, zorder=20, fontsize=12, ha='left', ma='left'):
    return ax.annotate(
        lbl,
        xy=xy,
        xytext=xytext,
        textcoords='offset points',
        fontsize=fontsize,
        bbox=dict(boxstyle='round,pad=0.5', facecolor=facecolor, alpha=0.97),
        arrowprops=dict(arrowstyle='->'),
        ha=ha,
        multialignment=ma,
        zorder=zorder,
    )


def _rich_annotate(ax, data_xy, xytext_pts, ha, rich_segments, header_text, bg_color='white', downward=False):
    if downward:
        xytext_pts = (xytext_pts[0], -abs(xytext_pts[1]) or -10)
    fp = dict(fontsize=12, fontfamily='monospace')
    fp_sym   = dict(fontsize=12, fontfamily=['Segoe UI Emoji', 'Segoe UI Symbol', 'DejaVu Sans'])
    fp_emoji = dict(fontsize=12, fontfamily=['Segoe UI Emoji', 'DejaVu Sans'])

    all_rows = []

    if header_text:
        for hline in header_text.split('\n'):
            all_rows.append(TextArea(hline or ' ', textprops=dict(**fp, color=_COLOR_TEXT)))
        all_rows.append(TextArea(' ', textprops=dict(**fp, color=_COLOR_TEXT)))

    current_row_parts = []
    current_chars = ''
    current_chars_dev = ''

    def flush_chars():
        nonlocal current_chars, current_chars_dev
        if current_chars_dev:
            current_row_parts.append(
                TextArea(current_chars_dev, textprops=dict(**fp, color=_COLOR_DEV))
            )
            current_chars_dev = ''
        if not current_chars:
            return
        buf = ''
        for ch in current_chars:
            if ord(ch) > 0xFFFF:
                if buf:
                    current_row_parts.append(TextArea(buf, textprops=dict(**fp, color=_COLOR_TEXT)))
                    buf = ''
                current_row_parts.append(TextArea(ch, textprops=dict(**fp_emoji, color=_COLOR_TEXT)))
            else:
                buf += ch
        if buf:
            current_row_parts.append(TextArea(buf, textprops=dict(**fp, color=_COLOR_TEXT)))
        current_chars = ''

    def flush_chars_dev():
        nonlocal current_chars, current_chars_dev
        if current_chars:
            flush_chars()
        if not current_chars_dev:
            return
        current_row_parts.append(
            TextArea(current_chars_dev, textprops=dict(**fp, color=_COLOR_DEV))
        )
        current_chars_dev = ''

    def finish_row():
        flush_chars()
        if current_row_parts:
            row = (current_row_parts[0] if len(current_row_parts) == 1
                   else HPacker(children=list(current_row_parts), pad=0, sep=0))
            all_rows.append(row)
        else:
            all_rows.append(TextArea(' ', textprops=dict(**fp, color=_COLOR_TEXT)))
        current_row_parts.clear()

    line_count = 0
    truncated  = False
    for kind, val in rich_segments:
        if truncated:
            break
        if kind == 'newline':
            finish_row()
            line_count += 1
            if line_count >= Config.TOOLTIP_MAX_LINES:
                current_row_parts.append(
                    TextArea('[... more text ...]', textprops=dict(**fp, color='#888888'))
                )
                truncated = True
        elif kind == 'char':
            if current_chars_dev:
                flush_chars_dev()
            if len(current_chars) >= Config.TOOLTIP_WIDTH:
                flush_chars()
                finish_row()
                line_count += 1
            current_chars += val
        elif kind == 'char_dev':
            if current_chars:
                flush_chars()
            if len(current_chars_dev) >= Config.TOOLTIP_WIDTH:
                flush_chars_dev()
                finish_row()
                line_count += 1
            current_chars_dev += val
        elif kind == 'delete':
            flush_chars()
            current_row_parts.append(
                TextArea(val, textprops=dict(**fp_sym, color=_COLOR_DELETE))
            )
        elif kind == 'delete_ignored':
            flush_chars()
            current_row_parts.append(
                TextArea(val, textprops=dict(**fp_sym, color=_COLOR_DELETE_IGNORED))
            )
        elif kind == 'anchor':
            flush_chars()
            current_row_parts.append(
                TextArea(val, textprops=dict(**fp, color=_COLOR_ANCHOR))
            )
        elif kind == 'move':
            flush_chars()
            current_row_parts.append(
                TextArea(f'→{val}', textprops=dict(**fp, color=_COLOR_MOVE))
            )
        elif kind in ('missing_tok', 'extra_tok', 'missing_count', 'extra_count', 'ghost_extra'):
            flush_chars()
            color = _COLOR_MISSING_TOK if kind in ('missing_tok', 'missing_count') else _COLOR_EXTRA_TOK
            weight = 'bold' if kind in ('missing_count', 'extra_count', 'ghost_extra') else 'normal'
            current_row_parts.append(
                TextArea(val, textprops=dict(**fp, color=color, fontweight=weight))
            )
    finish_row()

    if not all_rows:
        all_rows.append(TextArea('(empty)', textprops=dict(**fp, color='#888888')))

    vbox = VPacker(children=all_rows, pad=4, sep=1)
    _ba_y = 1.0 if downward else 0.0
    box_alignment = (1.0, _ba_y) if ha == 'right' else (0.0, _ba_y)

    ab = AnnotationBbox(
        vbox,
        data_xy,
        xybox=xytext_pts,
        boxcoords='offset points',
        box_alignment=box_alignment,
        bboxprops=dict(boxstyle='round,pad=0.5', facecolor=bg_color,
                       alpha=0.95, edgecolor='#cccccc'),
        arrowprops=dict(arrowstyle='->'),
        zorder=20,
    )
    ab.set_clip_on(False)
    ax.add_artist(ab)
    return ab

def _mismatch_to_rich_segments(all_mismatches):
    _mc = Counter(all_mismatches)
    seen, seen_set = [], set()
    for tok in all_mismatches:
        if tok not in seen_set:
            seen.append(tok)
            seen_set.add(tok)

    parts = []
    for raw in seen:
        count  = _mc[raw]
        prefix = raw[0] if raw and raw[0] in '+-' else ''
        display = raw[1:] if prefix else raw
        has_star = display.endswith('*')
        if has_star:
            display = display[:-1]
        if prefix == '-':
            kind = 'missing_tok'
        elif prefix == '+':
            kind = 'extra_tok'
        else:
            kind = 'char'
        parts.append((kind, display))
        if has_star:
            parts.append(('ghost_extra', '*'))
        if count > 1:
            count_kind = 'missing_count' if kind == 'missing_tok' else ('extra_count' if kind == 'extra_tok' else 'char')
            parts.append((count_kind, f'\u00d7{count}'))

    segments = []
    line_len = 0
    i_tok = 0
    for i, (kind, display) in enumerate(parts):
        is_count = kind in ('missing_count', 'extra_count', 'ghost_extra')
        if not is_count:
            if i_tok > 0:
                if line_len + len(display) + 2 > Config.TOOLTIP_WIDTH:
                    segments.append(('newline', ''))
                    line_len = 0
                else:
                    segments.append(('char', ','))
                    segments.append(('char', ' '))
                    line_len += 2
            i_tok += 1
        if kind == 'char':
            for ch in display:
                segments.append(('char', ch))
        else:
            segments.append((kind, display))
        line_len += len(display)

    return segments, len(_mc)


def _code_to_rich_segments(text):
    segments = []
    first = True
    for line in text.replace('\r', '').split('\n'):
        if not first:
            segments.append(('newline', ''))
        first = False
        parts = re.split(r'⚓([^⚓]+)⚓', line)
        for i, part in enumerate(parts):
            if i % 2 == 0:
                for ch in part:
                    segments.append(('char', ch))
            else:
                segments.append(('anchor', f'⚓{part}⚓'))
    return segments


def _tooltip_xytext(ax, event_x):
    try:
        bbox = ax.get_window_extent()
        mid  = (bbox.x0 + bbox.x1) / 2
        if event_x > mid:
            return (-10, 10), 'right', 'left'
    except Exception:
        pass
    return (10, 10), 'left', 'left'


def create_visualizations(data, student_data=None):
    key_presses = data['events']

    _active_editor = 'main'
    for ev in key_presses:
        if 'switch_editor' in ev:
            _active_editor = ev['switch_editor']
        elif 'move_to' in ev:
            t = ev['move_to']
            if t == 'DEV':  _active_editor = 'dev'
            elif t == 'MAIN': _active_editor = 'main'
        else:
            ev.setdefault('_editor', _active_editor)

    try:
        from .lv_editor import find_ignored_backspace_timestamps
        _ignored_bs_ts = find_ignored_backspace_timestamps(key_presses)
    except Exception:
        _ignored_bs_ts = set()

    session_start = key_presses[0]['timestamp'] / 1000
    session_end = key_presses[-1]['timestamp'] / 1000

    timestamps, rates, texts, widths = analyze_typing_blocks(key_presses)
    intervals = calculate_intervals(key_presses)
    interactions = extract_interactions(key_presses)

    datetime_stamps = [datetime.fromtimestamp(ts) for ts in timestamps]

    char_count = len([kp for kp in key_presses if 'char' in kp])
    dev_char_presses = [kp for kp in key_presses if 'char' in kp and kp.get('_editor') == 'dev']
    actual_avg_rate = char_count / ((session_end - session_start) / 60)

    if rates and widths:
        total_chars = sum(rate * (width * 24 * 60) for rate, width in zip(rates, widths))
        total_time = sum(width * 24 * 60 for width in widths)
        active_rate = total_chars / total_time if total_time > 0 else 0
    else:
        active_rate = 0

    has_student_data = student_data and len(student_data) > 0
    figsize = Config.CHART_FIGURE_SIZE if has_student_data else Config.CHART_FIGURE_SIZE_NO_STUDENTS
    fig = plt.figure(figsize=figsize)
    gs = GridSpec(3 if has_student_data else 2, 1, figure=fig, hspace=0.3)

    ax1 = fig.add_subplot(gs[0])

    min_width_days = Config.BAR_MIN_WIDTH_SECONDS / (24 * 3600)

    _DELETE_CHARS_SET = {chr(0x21a2), chr(0x21a3), chr(0x26d4)}

    _char_presses_all = [kp for kp in key_presses if 'char' in kp]
    _raw_blocks = []
    _singleton_chars = []
    if _char_presses_all:
        _cur = [_char_presses_all[0]]
        for _i in range(1, len(_char_presses_all)):
            _gap = (_char_presses_all[_i]['timestamp'] - _char_presses_all[_i-1]['timestamp']) / 1000
            if _gap < Config.BURST_GAP_THRESHOLD:
                _cur.append(_char_presses_all[_i])
            else:
                if len(_cur) >= Config.MIN_BURST_CHARS:
                    _raw_blocks.append(_cur)
                else:
                    _singleton_chars.extend(_cur)
                _cur = [_char_presses_all[_i]]
        if len(_cur) >= Config.MIN_BURST_CHARS:
            _raw_blocks.append(_cur)
        else:
            _singleton_chars.extend(_cur)

    _bar_ts_ranges = []
    for blk in _raw_blocks:
        _bar_ts_ranges.append((blk[0]['timestamp'], blk[-1]['timestamp']))

    _GAP_MS = Config.BURST_GAP_THRESHOLD * 1000

    def _events_in_bar(bar_idx):
        if bar_idx >= len(_bar_ts_ranges):
            return []
        t0, t1 = _bar_ts_ranges[bar_idx]
        return [ev for ev in key_presses
                if t0 - _GAP_MS <= ev.get('timestamp', 0) <= t1 + _GAP_MS
                and ('anchor' in ev or 'move_to' in ev or 'move' in ev or 'jump_to' in ev)]

    _CLR_NORMAL = (Config.BAR_COLOR,            Config.BAR_EDGE_COLOR)
    _CLR_DEV    = ('#22aa22',                   '#116611')
    _CLR_REMOVE = (Config.CODE_REMOVE_BAR_COLOR, Config.CODE_REMOVE_BAR_EDGE_COLOR)

    def _bar_color_for(kp):
        if kp.get('_editor') == 'dev':
            return _CLR_DEV
        ch = kp.get('char', '')
        if ch in _DELETE_CHARS_SET and kp.get('timestamp') not in _ignored_bs_ts:
            return _CLR_REMOVE
        return _CLR_NORMAL

    bar_artists = []

    for i, (blk, dt, rate, text, width) in enumerate(
            zip(_raw_blocks, datetime_stamps, rates, texts, widths)):

        runs = []
        for kp in blk:
            clr = _bar_color_for(kp)
            if runs and runs[-1][0] == clr:
                runs[-1][1].append(kp)
            else:
                runs.append((clr, [kp]))

        total_dur = (blk[-1]['timestamp'] - blk[0]['timestamp']) / 1000 or 1
        extra_evs = _events_in_bar(i)

        if len(runs) == 1 or total_dur < Config.BAR_MIN_WIDTH_SECONDS:
            clr = max(runs, key=lambda r: len(r[1]))[0]
            b = ax1.bar(dt, rate, width=max(width, min_width_days),
                        alpha=Config.BAR_ALPHA, color=clr[0], edgecolor=clr[1], zorder=2)
            bar_artists.append({'rect': b[0], 'text': text, 'rate': rate,
                                'time': dt, 'width': width,
                                'raw_block': blk,
                                'extra_events': extra_evs})
        else:
            for clr, run_kps in runs:
                run_dur = (run_kps[-1]['timestamp'] - run_kps[0]['timestamp']) / 1000 or 0.1
                run_frac = run_dur / total_dur
                run_w = max(width * run_frac, min_width_days / 2)
                run_dt = datetime.fromtimestamp(
                    (run_kps[0]['timestamp'] + run_kps[-1]['timestamp']) / 2 / 1000)
                run_text = "".join(kp.get('char', '') for kp in run_kps)
                b = ax1.bar(run_dt, rate, width=run_w,
                            alpha=Config.BAR_ALPHA, color=clr[0], edgecolor=clr[1], zorder=2)
                bar_artists.append({'rect': b[0], 'text': run_text, 'rate': rate,
                                    'time': run_dt, 'width': run_w,
                                    'raw_block': run_kps,
                                    'extra_events': extra_evs})

    for kp in key_presses:
        if 'code_insert' not in kp:
            continue
        code = kp['code_insert']
        ci_ts = kp['timestamp'] / 1000
        ci_dt = datetime.fromtimestamp(ci_ts)
        ci_rate = max(10.0, len(code) / (Config.BAR_MIN_WIDTH_SECONDS / 60.0))
        ci_bars = ax1.bar(
            ci_dt, ci_rate, width=min_width_days,
            alpha=0.6, color='#999999', edgecolor='#666666', zorder=3,
        )
        if ci_bars:
            bar_artists.append({
                'rect': ci_bars[0],
                'text': code,
                'rate': ci_rate,
                'time': ci_dt,
                'width': min_width_days,
                'is_code_insert': True,
            })

    _covered_ranges = _bar_ts_ranges

    def _in_any_block(ts_ms):
        return any(t0 - _GAP_MS <= ts_ms <= t1 + _GAP_MS for t0, t1 in _covered_ranges)

    _STANDALONE_RATE = 20.0

    for _skp in _singleton_chars:
        _s_ts = _skp['timestamp'] / 1000
        _s_dt = datetime.fromtimestamp(_s_ts)
        _s_clr = _bar_color_for(_skp)
        _s_bars = ax1.bar(
            _s_dt, _STANDALONE_RATE, width=min_width_days,
            alpha=Config.BAR_ALPHA, color=_s_clr[0], edgecolor=_s_clr[1], zorder=2,
        )
        if _s_bars:
            bar_artists.append({
                'rect': _s_bars[0],
                'text': _skp.get('char', ''),
                'rate': _STANDALONE_RATE,
                'time': _s_dt,
                'width': min_width_days,
                'is_singleton': True,
                'raw_block': [_skp],
            })

    for kp in key_presses:
        ts_ms = kp.get('timestamp', 0)
        ev_dt = datetime.fromtimestamp(ts_ms / 1000)

        if 'anchor' in kp and not _in_any_block(ts_ms):
            anc_bars = ax1.bar(
                ev_dt, _STANDALONE_RATE, width=min_width_days,
                alpha=0.75, color=Config.ANCHOR_DOT_COLOR,
                edgecolor=Config.ANCHOR_DOT_EDGE_COLOR, zorder=3,
            )
            if anc_bars:
                bar_artists.append({
                    'rect': anc_bars[0],
                    'text': kp['anchor'],
                    'rate': _STANDALONE_RATE,
                    'time': ev_dt,
                    'width': min_width_days,
                    'is_standalone_anchor': True,
                    'anchor_id': kp['anchor'],
                })

        elif 'move_to' in kp and kp['move_to'] not in ('DEV', 'MAIN') and not _in_any_block(ts_ms):
            mv_bars = ax1.bar(
                ev_dt, _STANDALONE_RATE, width=min_width_days,
                alpha=0.75, color=Config.MOVE_DOT_COLOR,
                edgecolor=Config.MOVE_DOT_EDGE_COLOR, zorder=3,
            )
            if mv_bars:
                bar_artists.append({
                    'rect': mv_bars[0],
                    'text': kp['move_to'],
                    'rate': _STANDALONE_RATE,
                    'time': ev_dt,
                    'width': min_width_days,
                    'is_standalone_move': True,
                    'move_target': kp['move_to'],
                })

        elif ('move' in kp or 'jump_to' in kp) and not _in_any_block(ts_ms):
            target = kp.get('move') or kp.get('jump_to', '')
            mv_bars = ax1.bar(
                ev_dt, _STANDALONE_RATE, width=min_width_days,
                alpha=0.75, color=Config.MOVE_DOT_COLOR,
                edgecolor=Config.MOVE_DOT_EDGE_COLOR, zorder=3,
            )
            if mv_bars:
                bar_artists.append({
                    'rect': mv_bars[0],
                    'text': target,
                    'rate': _STANDALONE_RATE,
                    'time': ev_dt,
                    'width': min_width_days,
                    'is_standalone_move': True,
                    'move_target': target,
                })

    ax1.set_ylabel('Keys per Minute (kpm)', fontsize=11)
    ax1.set_yscale('log')
    ax1.yaxis.set_major_formatter(plt.ScalarFormatter())
    ax1.yaxis.set_minor_formatter(plt.NullFormatter())
    ax1.yaxis.set_major_locator(plt.FixedLocator([10, 100, 1000]))
    ax1.grid(True, alpha=0.3, axis='y')
    ax1.xaxis.set_major_formatter(mdates.DateFormatter('%H:%M:%S'))
    plt.setp(ax1.xaxis.get_majorticklabels(), rotation=45)

    ax1.axhline(
        y=actual_avg_rate,
        color=Config.SESSION_RATE_COLOR,
        linestyle='--',
        alpha=Config.LINE_ALPHA,
        linewidth=Config.LINE_WIDTH,
        label=f'Session Rate : {actual_avg_rate:.1f} kpm'
    )
    ax1.axhline(
        y=active_rate,
        color=Config.ACTIVE_RATE_COLOR,
        linestyle='--',
        alpha=Config.LINE_ALPHA,
        linewidth=Config.LINE_WIDTH,
        label=f'Active Rate   : {active_rate:.1f} kpm'
    )
    ax1.legend(loc='upper right')

    ax1.set_xlim(
        datetime.fromtimestamp(session_start - Config.SESSION_PADDING_SECONDS),
        datetime.fromtimestamp(session_end + Config.SESSION_PADDING_SECONDS)
    )

    ax2 = fig.add_subplot(gs[1], sharex=ax1)
    ax1.set_zorder(ax2.get_zorder() + 1)
    ax1.patch.set_visible(False)

    char_indices = [i for i, kp in enumerate(key_presses) if 'char' in kp]
    cum_dates = [datetime.fromtimestamp(key_presses[i]['timestamp']/1000) for i in char_indices]
    cum_keys = list(range(1, len(char_indices) + 1))
    orig_to_cum = {orig: ci for ci, orig in enumerate(char_indices)}

    burst_groups = []
    current_burst = []
    for i, interval in enumerate(intervals):
        if interval < Config.BURST_GAP_THRESHOLD:
            if not current_burst:
                current_burst = [i]
            current_burst.append(i + 1)
        else:
            if len(current_burst) > 1:
                filtered = [idx for idx in current_burst if idx in orig_to_cum]
                if len(filtered) > 1:
                    burst_groups.append(filtered)
            current_burst = []

    if len(current_burst) > 1:
        filtered = [idx for idx in current_burst if idx in orig_to_cum]
        if len(filtered) > 1:
            burst_groups.append(filtered)

    ax2.plot(
        cum_dates, cum_keys,
        linewidth=Config.CUMULATIVE_LINE_WIDTH,
        color=Config.CUMULATIVE_LINE_COLOR,
        zorder=2
    )
    ax2.fill_between(
        cum_dates, cum_keys,
        alpha=Config.CUMULATIVE_FILL_ALPHA,
        color=Config.CUMULATIVE_LINE_COLOR,
        zorder=1
    )

    burst_artists = []
    for b_indices in burst_groups:
        b_times = [cum_dates[orig_to_cum[i]] for i in b_indices]
        b_counts = [cum_keys[orig_to_cum[i]] for i in b_indices]
        scatter = ax2.scatter(
            b_times, b_counts,
            color=Config.BURST_MARKER_COLOR,
            alpha=Config.BURST_MARKER_ALPHA,
            s=Config.BURST_MARKER_SIZE,
            zorder=3,
            edgecolors='none'
        )
        for i, idx in enumerate(b_indices):
            burst_artists.append({
                'scatter': scatter,
                'x': b_times[i],
                'y': b_counts[i],
                'keypress': key_presses[idx]
            })

    code_insert_artists = []
    for kp in key_presses:
        if 'code_insert' not in kp:
            continue
        ci_ts = kp['timestamp']
        ci_dt = datetime.fromtimestamp(ci_ts / 1000)

        chars_before = sum(1 for j in char_indices if key_presses[j]['timestamp'] <= ci_ts)
        sc = ax2.scatter(
            ci_dt, chars_before,
            color='#999999',
            alpha=0.85,
            s=Config.BURST_MARKER_SIZE * 4,
            zorder=5,
            marker='D',
            edgecolors='#666666',
            linewidths=1,
        )
        code_insert_artists.append({
            'scatter': sc,
            'x': ci_dt,
            'y': chars_before,
            'code': kp['code_insert'],
        })

    _DELETE_CHARS = {'↢', '⌫', '↣', '⌦', '⛔'}
    _DELETE_LABELS = {'↢': 'backspace', '⌫': 'backspace', '↣': 'delete', '⌦': 'delete', '⛔': 'delete line (Ctrl+Shift+K)'}
    delete_dot_artists = []
    for kp in key_presses:
        ch = kp.get('char', '')
        if ch not in _DELETE_CHARS:
            continue
        if kp.get('_editor', 'main') != 'main':
            continue
        d_ts = kp['timestamp']
        d_dt = datetime.fromtimestamp(d_ts / 1000)
        chars_at = sum(1 for j in char_indices if key_presses[j]['timestamp'] <= d_ts)
        is_ignored = (ch in ('↢', '⌫') and d_ts in _ignored_bs_ts)
        sc = ax2.scatter(
            d_dt, chars_at,
            color='#FFAAAA' if is_ignored else Config.CODE_REMOVE_DOT_COLOR,
            alpha=0.4 if is_ignored else 0.80,
            s=Config.BURST_MARKER_SIZE * 2,
            zorder=4,
            marker='o',
            linewidths=0.8,
            edgecolors='#FFAAAA' if is_ignored else Config.CODE_REMOVE_DOT_EDGE_COLOR,
        )
        delete_dot_artists.append({
            'scatter': sc,
            'x': d_dt,
            'y': chars_at,
            'char': ch,
            'label': ('backspace (ignored)' if is_ignored
                      else _DELETE_LABELS.get(ch, ch)),
            'ignored': is_ignored,
        })

    _DOT_S = Config.BURST_MARKER_SIZE

    dev_dot_artists = []
    for kp in dev_char_presses:
        d_ts  = kp['timestamp']
        d_dt  = datetime.fromtimestamp(d_ts / 1000)
        chars_before = sum(1 for j in char_indices if key_presses[j]['timestamp'] <= d_ts)
        sc = ax2.scatter(
            d_dt, chars_before,
            color=Config.DEV_DOT_COLOR, alpha=0.80, s=_DOT_S, zorder=4,
            marker='o', edgecolors=Config.DEV_DOT_EDGE_COLOR, linewidths=0.8,
        )
        dev_dot_artists.append({'scatter': sc, 'x': d_dt, 'y': chars_before,
                                'char': kp.get('char', '')})

    anchor_dot_artists = []
    move_dot_artists   = []

    _anchor_groups = defaultdict(list)
    _move_events   = []

    for kp in key_presses:
        ev_ts = kp['timestamp']
        ev_dt = datetime.fromtimestamp(ev_ts / 1000)
        chars_at = sum(1 for j in char_indices if key_presses[j]['timestamp'] <= ev_ts)

        if 'anchor' in kp:
            _anchor_groups[(ev_ts, chars_at)].append(kp['anchor'])

        elif 'move_to' in kp:
            t = kp['move_to']
            if t not in ('DEV', 'MAIN'):
                _move_events.append((ev_dt, chars_at, t))
        elif 'move' in kp or 'jump_to' in kp:
            target = kp.get('move') or kp.get('jump_to', '')
            _move_events.append((ev_dt, chars_at, target))

    for (ev_ts, chars_at), anchor_ids in _anchor_groups.items():
        ev_dt = datetime.fromtimestamp(ev_ts / 1000)
        sc = ax2.scatter(
            ev_dt, chars_at,
            color=Config.ANCHOR_DOT_COLOR, alpha=0.90, s=_DOT_S, zorder=6,
            marker='o', edgecolors=Config.ANCHOR_DOT_EDGE_COLOR, linewidths=0.8,
        )
        anchor_dot_artists.append({
            'scatter': sc, 'x': ev_dt, 'y': chars_at,
            'anchor_ids': anchor_ids,
        })

    for ev_dt, chars_at, target in _move_events:
        sc = ax2.scatter(
            ev_dt, chars_at,
            color=Config.MOVE_DOT_COLOR, alpha=0.90, s=_DOT_S, zorder=6,
            marker='o', edgecolors=Config.MOVE_DOT_EDGE_COLOR, linewidths=0.8,
        )
        move_dot_artists.append({'scatter': sc, 'x': ev_dt, 'y': chars_at,
                                 'target': target})

    for cia in code_insert_artists:
        code = cia.get('code', '')
        anchor_ids = re.findall(r'⚓([^⚓]*)⚓', code)
        if not anchor_ids:
            continue
        existing = next((a for a in anchor_dot_artists
                         if a['x'] == cia['x'] and a['y'] == cia['y']), None)
        labels = [f'⚓{aid}⚓ (in code_insert)' for aid in anchor_ids]
        if existing:
            existing['anchor_ids'].extend(labels)
        else:
            sc = ax2.scatter(
                cia['x'], cia['y'],
                color=Config.ANCHOR_DOT_COLOR, alpha=0.90, s=_DOT_S, zorder=7,
                marker='o', edgecolors=Config.ANCHOR_DOT_EDGE_COLOR, linewidths=0.8,
            )
            anchor_dot_artists.append({
                'scatter': sc, 'x': cia['x'], 'y': cia['y'],
                'anchor_ids': labels,
            })

    question_artists = []

    def make_interaction_block(q, color, itype, key_presses):
        q_ts = q['timestamp']
        closed_at = q.get('closed_at', None)
        if closed_at:
            end_ts = closed_at / 1000
        else:
            end_ts = None
            for kp in key_presses:
                if kp['timestamp']/1000 > q_ts:
                    end_ts = kp['timestamp']/1000
                    break

        if end_ts:
            start = datetime.fromtimestamp(q_ts)
            end = datetime.fromtimestamp(end_ts)
            rect = ax2.axvspan(start, end, color=color, alpha=Config.QUESTION_ALPHA, zorder=4)
            question_artists.append({
                'rect': rect,
                'type': itype,
                'data': q,
                'start': start,
                'end': end,
                'x': start
            })
        else:
            line = ax2.axvline(
                datetime.fromtimestamp(q_ts),
                color=color,
                linewidth=Config.QUESTION_LINE_WIDTH,
                alpha=Config.QUESTION_LINE_ALPHA
            )
            question_artists.append({
                'line': line,
                'type': itype,
                'data': q,
                'x': datetime.fromtimestamp(q_ts)
            })

    for q in interactions['teacher-question']:
        make_interaction_block(q, Config.QUESTION_UNANSWERED_COLOR, 'teacher-question', key_presses)
        if q['answered_by']:
            _q_ts = q['timestamp']
            _q_start = datetime.fromtimestamp(_q_ts)
            _closed = q.get('closed_at')
            if _closed:
                _q_end = datetime.fromtimestamp(_closed / 1000)
            else:
                _q_end = None
                for _kp in key_presses:
                    if _kp['timestamp'] / 1000 > _q_ts:
                        _q_end = datetime.fromtimestamp(_kp['timestamp'] / 1000)
                        break
            _tf_ans = _blended_tf(ax2.transData, ax2.transAxes)
            if _q_end:
                _x0n = mdates.date2num(_q_start)
                _x1n = mdates.date2num(_q_end)
                ax2.add_patch(mpatches.Rectangle(
                    (_x0n, 0.975), _x1n - _x0n, 0.025,
                    transform=_tf_ans, color='#1976D2', alpha=0.75, zorder=7, clip_on=True,
                ))
            else:
                ax2.axvline(_q_start, color='#1976D2', linewidth=3, alpha=0.7, zorder=7)

    for q in interactions['student-question']:
        make_interaction_block(q, Config.QUESTION_STUDENT_COLOR, 'student-question', key_presses)

    for q in interactions['providing-help']:
        make_interaction_block(q, Config.QUESTION_HELP_COLOR, 'providing-help', key_presses)

    ax2.set_ylabel('Total Key Presses', fontsize=11)
    ax2.grid(True, alpha=0.3)
    ax2.xaxis.set_major_formatter(mdates.DateFormatter('%H:%M:%S'))
    plt.setp(ax2.xaxis.get_majorticklabels(), rotation=45)

    _n_ci  = sum(1 for kp in key_presses if 'code_insert' in kp)
    _n_anc = sum(len(v) for v in _anchor_groups.values()) + sum(
                len(re.findall(r'⚓([^⚓]*)⚓', kp.get('code_insert','')))
                for kp in key_presses if 'code_insert' in kp)
    _n_mv  = len(_move_events)
    _n_del = len([d for d in delete_dot_artists if not d.get('ignored')])
    _n_dev = len(dev_dot_artists)
    _legend_handles = [
        mlines.Line2D([],[], color='black',      marker='o', linestyle='None',
                      markersize=5, label=f'Key Presses ({char_count})'),
        mlines.Line2D([],[], color='#999999',    marker='D', linestyle='None',
                      markersize=6, label=f'Code Inserts ({_n_ci})'),
        mlines.Line2D([],[], color=Config.CODE_REMOVE_DOT_COLOR, marker='o', linestyle='None',
                      markersize=5, label=f'Delete ({_n_del})'),
        mlines.Line2D([],[], color=Config.ANCHOR_DOT_COLOR, marker='o', linestyle='None',
                      markersize=5, label=f'Anchor ({_n_anc})'),
        mlines.Line2D([],[], color=Config.MOVE_DOT_COLOR,   marker='o', linestyle='None',
                      markersize=5, label=f'Move To ({_n_mv})'),
        mlines.Line2D([],[], color=Config.DEV_DOT_COLOR,    marker='o', linestyle='None',
                      markersize=5, label=f'Dev Tools ({_n_dev})'),
    ]
    ax2.legend(handles=_legend_handles, loc='upper left', fontsize=10,
               framealpha=0.9, ncol=2)

    student_artists = []
    follow_bar_artists = []

    follow_dot_scatters_by_name = {}
    ax3 = None
    if has_student_data:
        ax3 = fig.add_subplot(gs[2], sharex=ax1)

        students_answering = {}
        for q in interactions['teacher-question']:
            for name in q['answered_by']:
                if name not in students_answering:
                    students_answering[name] = []
                students_answering[name].append(q.get('info', 'Question'))

        students_asking = {}
        for q in interactions['student-question']:
            name = q.get('asked_by', '').strip()
            if name:
                if name not in students_asking:
                    students_asking[name] = []
                students_asking[name].append(q.get('info', '') or '(question)')

        students_helped = {}
        for q in interactions['providing-help']:
            name = q.get('student', '').strip()
            if name:
                if name not in students_helped:
                    students_helped[name] = []
                students_helped.setdefault(name, []).append(q.get('info', '') or '(help)')

        def _jitter_x(dt):
            if not Config.DOT_JITTER_X_SECONDS:
                return dt
            return dt + timedelta(seconds=random.uniform(
                -Config.DOT_JITTER_X_SECONDS, Config.DOT_JITTER_X_SECONDS))

        def _jitter_y(y):
            if not Config.DOT_JITTER_Y_PCT:
                return y
            return y + random.uniform(-Config.DOT_JITTER_Y_PCT, Config.DOT_JITTER_Y_PCT)

        students_with_answers = []
        students_without_answers = []

        for s in student_data:
            events = s.get('follow_events', [])
            kw_label, event_dt = events[0] if events else ('', s.get('follow_dt'))
            if event_dt is None:
                continue
            ans_list  = students_answering.get(s['name'], [])
            ask_list  = students_asking.get(s['name'], [])
            help_list = students_helped.get(s['name'], [])
            s_info = {
                'data': s,
                'x': event_dt,
                'y': s['follow_pct'],
                'x_orig': event_dt,
                'y_orig': s['follow_pct'],
                'answered': ans_list,
                'asked':    ask_list,
                'helped':   help_list,
                'kw_label': kw_label or '',
            }
            if ans_list or ask_list or help_list:
                students_with_answers.append(s_info)
            else:
                students_without_answers.append(s_info)

        for s_info in students_without_answers:
            kw = s_info['kw_label']
            is_end = isinstance(kw, str) and kw.startswith('(followed')
            sc = ax3.scatter(
                s_info['x'], s_info['y'],
                s=Config.STUDENT_MARKER_SIZE,
                color=Config.STUDENT_NO_ANSWER_COLOR,
                marker='D' if is_end else 'o',
                alpha=Config.STUDENT_ALPHA,
                edgecolors='black',
                linewidths=1,
                zorder=5,
            )
            s_info['scatter'] = sc
            student_artists.append(s_info)

        if Config.SHOW_ALL_FOLLOW_DOTS:
            _follow_bar_height = 2.0

            for s in student_data:
                name = s['name']
                y_base = s['follow_pct']
                evs = [
                    (kw, dt) for kw, dt in s.get('follow_events', [])
                    if dt is not None
                    and not (isinstance(kw, str) and kw.startswith('(followed'))
                ]
                if not evs:
                    continue
                evs.sort(key=lambda e: e[1])
                clusters = []
                _fcur = [evs[0]]
                for _fi in range(1, len(evs)):
                    _fgap = (evs[_fi][1] - evs[_fi - 1][1]).total_seconds()
                    if _fgap < Config.BURST_GAP_THRESHOLD:
                        _fcur.append(evs[_fi])
                    else:
                        clusters.append(_fcur)
                        _fcur = [evs[_fi]]
                clusters.append(_fcur)

                for cl in clusters:
                    t_start = cl[0][1]
                    t_end = cl[-1][1]
                    x0 = mdates.date2num(t_start)
                    x1 = mdates.date2num(t_end)
                    bar_w = max(x1 - x0, min_width_days)
                    y_bot = y_base - _follow_bar_height / 2
                    rect = mpatches.Rectangle(
                        (x0, y_bot), bar_w, _follow_bar_height,
                        alpha=0.4, color='#AAAAAA', linewidth=0, zorder=1,
                    )
                    ax3.add_patch(rect)
                    follow_bar_artists.append({
                        'rect': rect,
                        'x0': x0, 'x1': x0 + bar_w,
                        'y0': y_bot, 'y1': y_bot + _follow_bar_height,
                        'y0_orig': y_bot, 'x0_orig': x0,
                        'x_center': x0 + bar_w / 2,
                        'y_center': y_base,
                        'name': name,
                        'student': s,
                        'mismatches': [kw for kw, _ in cl],
                    })

        for s_info in students_with_answers:
            answered = bool(s_info['answered'])
            asked    = bool(s_info['asked'])
            helped   = bool(s_info['helped'])
            x, y     = s_info['x'], s_info['y']
            s_info['halos'] = []

            if answered:
                fill_color = Config.STUDENT_ANSWERED_COLOR
            elif asked:
                fill_color = Config.STUDENT_ASKED_COLOR
            else:
                fill_color = Config.STUDENT_HELPED_COLOR

            if answered and asked and helped:
                _h = ax3.scatter(x, y, s=Config.STUDENT_STAR_HALO2_SIZE,
                            color=Config.STUDENT_HELPED_COLOR, marker='*',
                            alpha=1.0, edgecolors='none', zorder=10)
                s_info['halos'].append(_h)
                _h = ax3.scatter(x, y, s=Config.STUDENT_STAR_HALO1_SIZE,
                            color=Config.STUDENT_ASKED_COLOR, marker='*',
                            alpha=1.0, edgecolors='none', zorder=11)
                s_info['halos'].append(_h)
            elif answered and asked:
                _h = ax3.scatter(x, y, s=Config.STUDENT_STAR_HALO1_SIZE,
                            color=Config.STUDENT_ASKED_COLOR, marker='*',
                            alpha=1.0, edgecolors='none', zorder=10)
                s_info['halos'].append(_h)
            elif answered and helped:
                _h = ax3.scatter(x, y, s=Config.STUDENT_STAR_HALO1_SIZE,
                            color=Config.STUDENT_HELPED_COLOR, marker='*',
                            alpha=1.0, edgecolors='none', zorder=10)
                s_info['halos'].append(_h)
            elif asked and helped:
                _h = ax3.scatter(x, y, s=Config.STUDENT_STAR_HALO1_SIZE,
                            color=Config.STUDENT_HELPED_COLOR, marker='*',
                            alpha=1.0, edgecolors='none', zorder=10)
                s_info['halos'].append(_h)

            top_zorder = 12 if (answered and asked and helped) else 11
            sc = ax3.scatter(
                x, y,
                s=Config.STUDENT_MARKER_SIZE_ANSWERED,
                color=fill_color,
                marker='*',
                alpha=Config.STUDENT_ALPHA_ANSWERED,
                edgecolors='none',
                linewidths=0,
                zorder=top_zorder,
            )
            s_info['scatter'] = sc
            student_artists.append(s_info)

        ax3.set_xlabel('Mismatch', fontsize=10)
        ax3.set_ylabel('Follow Score (%)', fontsize=11)
        ax3.grid(True, alpha=0.3)
        ax3.xaxis.set_major_formatter(mdates.DateFormatter('%H:%M:%S'))
        plt.setp(ax3.xaxis.get_majorticklabels(), rotation=45)

    curr_ann = {'ax1': None, 'ax2': None, 'ax3': None}
    curr_highlight = {'scatters': []}
    crosshair = {
        'ax1_line': None,
        'ax2_line': None,
        'ax3_line': None,
        'time_label': None,
    }
    keyboard_state = {'space_pressed': False}

    def on_key_press(event):
        if event.key == Config.CROSSHAIR_KEY:
            keyboard_state['space_pressed'] = True

    def on_key_release(event):
        if event.key == Config.CROSSHAIR_KEY:
            keyboard_state['space_pressed'] = False
            if crosshair['ax1_line']:
                crosshair['ax1_line'].remove()
                crosshair['ax1_line'] = None
            if crosshair['ax2_line']:
                crosshair['ax2_line'].remove()
                crosshair['ax2_line'] = None
            if crosshair['ax3_line']:
                crosshair['ax3_line'].remove()
                crosshair['ax3_line'] = None
            if crosshair['time_label']:
                crosshair['time_label'].remove()
                crosshair['time_label'] = None
            fig.canvas.draw_idle()

    def _clear_highlight():
        for sc in curr_highlight['scatters']:
            try:
                sc.remove()
            except Exception:
                pass
        curr_highlight['scatters'] = []

    def _highlight_student(name):
        _clear_highlight()
        for fb in follow_bar_artists:
            if fb['name'] == name:
                hl = mpatches.Rectangle(
                    (fb['x0'], fb['y0']), fb['x1'] - fb['x0'], fb['y1'] - fb['y0'],
                    alpha=0.85, color='#222222', linewidth=0, zorder=4,
                )
                ax3.add_patch(hl)
                curr_highlight['scatters'].append(hl)

        for sa in student_artists:
            if sa['data']['name'] == name:
                base_sc = sa.get('scatter')
                try:
                    dot_size = base_sc.get_sizes()[0] if base_sc is not None else Config.STUDENT_MARKER_SIZE
                except Exception:
                    dot_size = Config.STUDENT_MARKER_SIZE
                sc_main = ax3.scatter(
                    sa['x'], sa['y'],
                    s=dot_size, color='black', marker='o',
                    alpha=1.0, edgecolors='black', linewidths=1, zorder=20,
                )
                curr_highlight['scatters'].append(sc_main)

    def on_hover(event):
        try:
            _shake_ax = getattr(fig, '_shake_ax', None)
            _tk_widget = fig.canvas.get_tk_widget()
            if _shake_ax and event.inaxes == _shake_ax:
                _tk_widget.configure(cursor='hand2')
            else:
                _tk_widget.configure(cursor='')
        except Exception:
            pass
        if keyboard_state['space_pressed'] and (event.inaxes in [ax1, ax2] or (has_student_data and event.inaxes == ax3)):
            if event.xdata:
                if crosshair['ax1_line']:
                    crosshair['ax1_line'].remove()
                if crosshair['ax2_line']:
                    crosshair['ax2_line'].remove()
                if crosshair['ax3_line']:
                    crosshair['ax3_line'].remove()
                if crosshair['time_label']:
                    crosshair['time_label'].remove()

                crosshair['ax1_line'] = ax1.axvline(event.xdata, color='black', linewidth=1, alpha=0.5, zorder=1)
                crosshair['ax2_line'] = ax2.axvline(event.xdata, color='black', linewidth=1, alpha=0.5, zorder=1)
                if has_student_data and ax3:
                    crosshair['ax3_line'] = ax3.axvline(event.xdata, color='black', linewidth=1, alpha=0.5, zorder=1)

                time_dt = mdates.num2date(event.xdata)
                time_str = time_dt.strftime('%H:%M:%S')

                if event.inaxes == ax1:
                    y_pos = ax1.get_ylim()[0]
                    crosshair['time_label'] = ax1.text(
                        event.xdata, y_pos, time_str,
                        ha='center', va='top', fontsize=8,
                        bbox=dict(boxstyle='round,pad=0.3', facecolor='white', alpha=0.9, edgecolor='black'),
                        zorder=15
                    )
                elif event.inaxes == ax2:
                    y_pos = ax2.get_ylim()[0]
                    crosshair['time_label'] = ax2.text(
                        event.xdata, y_pos, time_str,
                        ha='center', va='top', fontsize=8,
                        bbox=dict(boxstyle='round,pad=0.3', facecolor='white', alpha=0.9, edgecolor='black'),
                        zorder=15
                    )
                elif has_student_data and event.inaxes == ax3:
                    y_pos = ax3.get_ylim()[0]
                    crosshair['time_label'] = ax3.text(
                        event.xdata, y_pos, time_str,
                        ha='center', va='top', fontsize=8,
                        bbox=dict(boxstyle='round,pad=0.3', facecolor='white', alpha=0.9, edgecolor='black'),
                        zorder=15
                    )

                fig.canvas.draw_idle()
        elif not keyboard_state['space_pressed']:
            changed = False
            if crosshair['ax1_line']:
                crosshair['ax1_line'].remove()
                crosshair['ax1_line'] = None
                changed = True
            if crosshair['ax2_line']:
                crosshair['ax2_line'].remove()
                crosshair['ax2_line'] = None
                changed = True
            if crosshair['ax3_line']:
                crosshair['ax3_line'].remove()
                crosshair['ax3_line'] = None
                changed = True
            if crosshair['time_label']:
                crosshair['time_label'].remove()
                crosshair['time_label'] = None
                changed = True
            if changed:
                fig.canvas.draw_idle()

        if event.inaxes not in [ax1, ax2] and (not has_student_data or event.inaxes != ax3):
            if crosshair['ax1_line']:
                crosshair['ax1_line'].remove()
                crosshair['ax1_line'] = None
            if crosshair['ax2_line']:
                crosshair['ax2_line'].remove()
                crosshair['ax2_line'] = None
            if crosshair['ax3_line']:
                crosshair['ax3_line'].remove()
                crosshair['ax3_line'] = None
            if crosshair['time_label']:
                crosshair['time_label'].remove()
                crosshair['time_label'] = None
            _clear_highlight()
            for k in curr_ann:
                if curr_ann[k]:
                    curr_ann[k].remove()
                    curr_ann[k] = None
            fig.canvas.draw_idle()
            return

        if event.inaxes == ax1:
            for k in curr_ann:
                if curr_ann[k]:
                    curr_ann[k].remove()
                    curr_ann[k] = None

            mouse_pt = (event.x, event.y)
            closest = None
            for ba in bar_artists:
                if ba['rect'].get_window_extent(fig.canvas.get_renderer()).contains(*mouse_pt):
                    closest = ba
                    break

            if closest:
                char_count = len(closest['text'])
                raw_block  = closest.get('raw_block', [])
                extra_evs  = closest.get('extra_events', [])

                if raw_block and not closest.get('is_code_insert'):
                    items = [(kp['timestamp'],
                               'char_dev' if kp.get('_editor') == 'dev' else 'char',
                               kp.get('char', '')) for kp in raw_block]
                    for _ev in extra_evs:
                        _ts = _ev.get('timestamp', 0)
                        if 'anchor' in _ev:
                            items.append((_ts, 'anchor', _ev['anchor']))
                        elif 'move_to' in _ev and _ev['move_to'] not in ('DEV', 'MAIN'):
                            items.append((_ts, 'move', _ev['move_to']))
                        elif 'move' in _ev:
                            items.append((_ts, 'move', _ev['move']))
                        elif 'jump_to' in _ev:
                            items.append((_ts, 'move', _ev['jump_to']))
                    items.sort(key=lambda x: x[0])

                    rich_segments = []
                    for _ts, _kind, _val in items:
                        if _kind in ('char', 'char_dev'):
                            if _val == '\r':
                                pass
                            elif _val == '\n':
                                rich_segments.append(('newline', ''))
                            elif _val in _DELETE_DISPLAY_SET:
                                if _ts in _ignored_bs_ts:
                                    rich_segments.append(('delete_ignored', _val))
                                else:
                                    rich_segments.append(('delete', _val))
                            else:
                                rich_segments.append((_kind, _val))
                        elif _kind == 'anchor':
                            rich_segments.append(('anchor', _val))
                        elif _kind == 'move':
                            rich_segments.append(('move', _val))

                    duration_seconds = closest['width'] * 24 * 60 * 60
                    duration_minutes = int(duration_seconds // 60)
                    duration_secs    = int(duration_seconds % 60)
                    header = (f"Duration: {duration_minutes}:{duration_secs:02d}\n"
                              f"Rate: {closest['rate']:.1f} kpm\n"
                              f"Chars: {char_count}")

                    y_pos = ax1.transData.inverted().transform((0, event.y))[1]
                    _xt, _ha, _ma = _tooltip_xytext(ax1, event.x)
                    ann = _rich_annotate(ax1, (closest['time'], y_pos), _xt, _ha,
                                         rich_segments, header, downward=True)
                    curr_ann['ax1'] = ann
                    fig.canvas.draw_idle()

                else:
                    if closest.get('is_standalone_anchor'):
                        rich_segs = [('anchor', closest['anchor_id'])]
                        y_pos = ax1.transData.inverted().transform((0, event.y))[1]
                        _xt, _ha, _ma = _tooltip_xytext(ax1, event.x)
                        ann = _rich_annotate(ax1, (closest['time'], y_pos), _xt, _ha,
                                             rich_segs, None, downward=True)
                    elif closest.get('is_standalone_move'):
                        rich_segs = [('move', closest['move_target'])]
                        y_pos = ax1.transData.inverted().transform((0, event.y))[1]
                        _xt, _ha, _ma = _tooltip_xytext(ax1, event.x)
                        ann = _rich_annotate(ax1, (closest['time'], y_pos), _xt, _ha,
                                             rich_segs, None, downward=True)
                    elif closest.get('is_code_insert'):
                        header = f'Code insert: {char_count} chars'
                        rich_segs = _code_to_rich_segments(closest['text'])
                        y_pos = ax1.transData.inverted().transform((0, event.y))[1]
                        _xt, _ha, _ma = _tooltip_xytext(ax1, event.x)
                        ann = _rich_annotate(ax1, (closest['time'], y_pos), _xt, _ha,
                                             rich_segs, header, downward=True)
                    elif not closest.get('is_standalone_anchor') and not closest.get('is_standalone_move') and not closest.get('is_code_insert'):
                        raw = closest['text']
                        lines = raw.split('\n')
                        display_lines = []
                        line_count = 0
                        for line in lines:
                            if line_count >= Config.TOOLTIP_MAX_LINES:
                                display_lines.append('[... more text ...]')
                                break
                            if not line:
                                display_lines.append('')
                                line_count += 1
                                continue
                            wrapped = textwrap.wrap(line, width=Config.TOOLTIP_WIDTH,
                                                    break_long_words=False,
                                                    replace_whitespace=False)
                            display_lines.extend(wrapped)
                            line_count += len(wrapped)
                        final_text = '\n'.join(display_lines)
                        label = f'Code remove: {char_count} chars\n\n{final_text}'
                        y_pos = ax1.transData.inverted().transform((0, event.y))[1]
                        _xt, _ha, _ma = _tooltip_xytext(ax1, event.x)
                        ann = ax1.annotate(
                            label,
                            xy=(closest['time'], y_pos),
                            xytext=_xt,
                            textcoords='offset points',
                            fontsize=12,
                            fontname='monospace',
                            bbox=dict(boxstyle='round,pad=0.5', facecolor='white', alpha=0.95),
                            arrowprops=dict(arrowstyle='->'),
                            ha=_ha,
                            multialignment=_ma,
                            zorder=20,
                        )
                    curr_ann['ax1'] = ann
                    fig.canvas.draw_idle()

        elif event.inaxes == ax2:
            for k in curr_ann:
                if curr_ann[k]:
                    curr_ann[k].remove()
                    curr_ann[k] = None

            _THRESH = Config.HOVER_DISTANCE_THRESHOLD * 2
            candidates = []
            _P = 1

            for ba in burst_artists:
                px = ax2.transData.transform((mdates.date2num(ba['x']), ba['y']))
                d = ((event.x - px[0])**2 + (event.y - px[1])**2)**0.5
                candidates.append((d, _P, 'burst', ba))

            for cia in code_insert_artists:
                px = ax2.transData.transform((mdates.date2num(cia['x']), cia['y']))
                d = ((event.x - px[0])**2 + (event.y - px[1])**2)**0.5
                candidates.append((d, _P, 'code_insert', cia))

            for mva in move_dot_artists:
                px = ax2.transData.transform((mdates.date2num(mva['x']), mva['y']))
                d = ((event.x - px[0])**2 + (event.y - px[1])**2)**0.5
                candidates.append((d, _P, 'move', mva))

            for ana in anchor_dot_artists:
                px = ax2.transData.transform((mdates.date2num(ana['x']), ana['y']))
                d = ((event.x - px[0])**2 + (event.y - px[1])**2)**0.5
                candidates.append((d, _P, 'anchor', ana))

            for dda in dev_dot_artists:
                px = ax2.transData.transform((mdates.date2num(dda['x']), dda['y']))
                d = ((event.x - px[0])**2 + (event.y - px[1])**2)**0.5
                candidates.append((d, _P, 'dev', dda))

            for del_a in delete_dot_artists:
                px = ax2.transData.transform((mdates.date2num(del_a['x']), del_a['y']))
                d = ((event.x - px[0])**2 + (event.y - px[1])**2)**0.5
                candidates.append((d, _P, 'delete', del_a))

            candidates.sort(key=lambda c: (c[0], c[1]))
            closest = candidates[0] if candidates else None

            if not closest or closest[0] > _THRESH:
                closest_q = None
                if event.x is not None:
                    for qa in question_artists:
                        if 'rect' in qa:
                            x0 = ax2.transData.transform((mdates.date2num(qa['start']), 0))[0]
                            x1 = ax2.transData.transform((mdates.date2num(qa['end']), 0))[0]
                            if x0 <= event.x <= x1:
                                closest_q = qa
                                break
                if closest_q:
                    q = closest_q['data']
                    qtype = closest_q.get('type', 'teacher-question')
                    if qtype == 'teacher-question':
                        info = q.get('info', '').strip()
                        answerers = q.get('answered_by', [])
                        txt = f"Q: {info}" if info else "Q: (teacher question)"
                        if answerers:
                            names = "\n".join(f"  • {name}" for name in answerers)
                            txt += f"\n\nAnswered by:\n{names}"
                        else:
                            txt += "\n\n(unanswered)"
                    elif qtype == 'student-question':
                        asked_by = q.get('asked_by', '').strip()
                        question_text = q.get('info', '').strip()
                        txt = f"Q: {question_text}" if question_text else "Q: (student question)"
                        if asked_by:
                            txt += f"\n\nAsked by:\n  • {asked_by}"
                    elif qtype == 'providing-help':
                        student_name = q.get('student', '').strip()
                        txt = "Providing help"
                        if student_name:
                            txt += f"\n\nStudent:\n  • {student_name}"
                    y_pos = ax2.transData.inverted().transform((0, event.y))[1]
                    _xt, _ha, _ma = _tooltip_xytext(ax2, event.x)
                    ann = ax2.annotate(
                        txt,
                        xy=(closest_q['x'], y_pos),
                        xytext=_xt,
                        textcoords='offset points',
                        fontsize=12,
                        bbox=dict(boxstyle='round', facecolor='white', alpha=0.9),
                        arrowprops=dict(arrowstyle='->'),
                        ha=_ha,
                        multialignment=_ma,
                        zorder=10
                    )
                    curr_ann['ax2'] = ann
                    fig.canvas.draw_idle()
                return

            dist, _, kind, art = closest
            _xt, _ha, _ma = _tooltip_xytext(ax2, event.x)

            if kind == 'move':
                lbl = f'->{art["target"]}'
                ann = _ax_annotate(ax2, lbl, (art['x'], art['y']), _xt, '#FFF3E0', ha=_ha, ma=_ma)

            elif kind == 'anchor':
                _ids = art.get('anchor_ids', [art.get('anchor_id', '?')])
                lbl = '\n'.join(_ids)
                ann = _ax_annotate(ax2, lbl, (art['x'], art['y']), _xt, '#E3F0FF', ha=_ha, ma=_ma)

            elif kind == 'dev':
                ann = _rich_annotate(ax2, (art['x'], art['y']), _xt, _ha,
                                     [('char_dev', art['char'])], None, bg_color='#E8F5E9')

            elif kind == 'delete':
                _del_seg = 'delete_ignored' if art.get('ignored') else 'delete'
                ann = _rich_annotate(ax2, (art['x'], art['y']), _xt, _ha,
                                     [(_del_seg, art['char'])], None, bg_color='#FDECEA')

            elif kind == 'code_insert':
                code = art['code']
                header = f'Code insert ({len(code)} chars):'
                rich_segs = _code_to_rich_segments(code)
                ann = _rich_annotate(ax2, (art['x'], art['y']), _xt, _ha, rich_segs, header)

            else:
                if dist > Config.HOVER_DISTANCE_THRESHOLD:
                    fig.canvas.draw_idle()
                    return
                char = art['keypress'].get('char', '?')
                _is_dev = art['keypress'].get('_editor') == 'dev'
                _seg_type = 'char_dev' if _is_dev else 'char'
                if char in ('\n', '\r'):
                    _segs = [(_seg_type, '↩')]
                    _bg = '#E8F5E9' if _is_dev else 'white'
                elif char == '\t':
                    _segs = [(_seg_type, '↣')]
                    _bg = '#E8F5E9' if _is_dev else 'white'
                elif char in _DELETE_DISPLAY_SET:
                    _del_kind = ('delete_ignored'
                                 if art['keypress'].get('timestamp') in _ignored_bs_ts
                                 else 'delete')
                    _segs = [(_del_kind, char)]
                    _bg = '#FDECEA'
                else:
                    _segs = [(_seg_type, char)]
                    _bg = '#E8F5E9' if _is_dev else 'white'
                ann = _rich_annotate(ax2, (art['x'], art['y']), _xt, _ha, _segs, None, bg_color=_bg)

            curr_ann['ax2'] = ann
            fig.canvas.draw_idle()

        elif has_student_data and event.inaxes == ax3:
            for k in curr_ann:
                if curr_ann[k]:
                    curr_ann[k].remove()
                    curr_ann[k] = None
            _clear_highlight()

            closest_s, min_d = None, float('inf')
            for sa in student_artists:
                px = ax3.transData.transform((mdates.date2num(sa['x']), sa['y']))
                dist = ((event.x - px[0])**2 + (event.y - px[1])**2)**0.5
                if dist < min_d:
                    min_d = dist
                    closest_s = sa

            if closest_s and min_d < 20:
                d   = closest_s['data']
                kw  = closest_s.get('kw_label', '')
                follow_pct_val = d.get('follow_pct')
                follow_str = f"{follow_pct_val:.1f}%" if follow_pct_val is not None else 'N/A'
                header = f"{d['name']} (Follow: {follow_str})"
                all_mismatches = [
                    label for label, _ in d.get('follow_events', [])
                    if label and not label.startswith('(followed')
                ]
                if closest_s['answered']:
                    ans_lines = "\n".join(f"  \u2022 {x}" for x in closest_s['answered'])
                    header += f"\n\nAnswered ({len(closest_s['answered'])}):\n{ans_lines}"
                if closest_s.get('asked'):
                    ask_lines = "\n".join(f"  \u2022 {x}" for x in closest_s['asked'])
                    header += f"\n\nAsked ({len(closest_s['asked'])}):\n{ask_lines}"
                if closest_s.get('helped'):
                    help_lines = "\n".join(f"  \u2022 {x}" for x in closest_s['helped'])
                    header += f"\n\nHelp received ({len(closest_s['helped'])}):\n{help_lines}"
                if all_mismatches:
                    tok_segs, n_distinct = _mismatch_to_rich_segments(all_mismatches)
                    label_str = f'Mismatches ({n_distinct}):'
                    final_segs = [('char', ch) for ch in label_str] + [('newline', '')] + tok_segs
                elif not kw or kw.startswith('(followed'):
                    header += "\n\n(followed till end)"
                    final_segs = []
                else:
                    final_segs = []
                _xt, _ha, _ma = _tooltip_xytext(ax3, event.x)
                ann = _rich_annotate(ax3, (closest_s['x'], closest_s['y']), _xt, _ha,
                                     final_segs, header)
                _highlight_student(d['name'])
                curr_ann['ax3'] = ann
                fig.canvas.draw_idle()
            elif follow_bar_artists:
                closest_fb, min_fb = None, float('inf')
                for fb in follow_bar_artists:
                    px = ax3.transData.transform((fb['x_center'], fb['y_center']))
                    dist = ((event.x - px[0])**2 + (event.y - px[1])**2)**0.5
                    if dist < min_fb:
                        min_fb = dist
                        closest_fb = fb
                if closest_fb and min_fb < Config.HOVER_DISTANCE_THRESHOLD * 3:
                    mismatches = closest_fb['mismatches']
                    follow_val = closest_fb['student'].get('follow_pct')
                    follow_disp = f"{follow_val:.1f}%" if follow_val is not None else 'N/A'
                    fb_header = f"{closest_fb['name']} (Follow: {follow_disp})"
                    if mismatches:
                        fb_segs, fb_count = _mismatch_to_rich_segments(mismatches)
                        fb_label = f'Mismatches ({fb_count}):'
                        final_segs = [('char', ch) for ch in fb_label] + [('newline', '')] + fb_segs
                    else:
                        final_segs = []
                    _xt, _ha, _ma = _tooltip_xytext(ax3, event.x)
                    ann = _rich_annotate(ax3, (mdates.num2date(closest_fb['x_center']),
                                               closest_fb['y_center']),
                                         _xt, _ha, final_segs, fb_header)
                    _highlight_student(closest_fb['name'])
                    curr_ann['ax3'] = ann
                    fig.canvas.draw_idle()

    def on_click(event):
        if has_student_data and event.inaxes == ax3 and event.xdata:
            closest_s, min_d = None, float('inf')
            xr = ax3.get_xlim()[1] - ax3.get_xlim()[0]
            yr = ax3.get_ylim()[1] - ax3.get_ylim()[0]
            for sa in student_artists:
                dx = abs(mdates.date2num(sa['x']) - mdates.date2num(event.xdata)) / xr
                dy = abs(sa['y'] - event.ydata) / yr
                dist = (dx**2 + dy**2)**0.5
                if dist < min_d:
                    min_d = dist
                    closest_s = sa

            if closest_s and min_d < Config.CLICK_DISTANCE_THRESHOLD:
                d      = closest_s['data']
                kw     = closest_s.get('kw_label', '')
                ev_dt  = closest_s.get('x_orig', closest_s['x'])
                ev_str = ev_dt.strftime('%H:%M:%S') if isinstance(ev_dt, datetime) else 'N/A'
                kw_line = 'Followed till end' if kw.startswith('(followed') else f'Token: {kw}'
                follow_val = d.get('follow_pct')
                follow_disp = f"{follow_val:.1f}%" if follow_val is not None else 'N/A'
                print(f"\n{'='*30}\nSTUDENT: {d['name']}\nFollow (E): {follow_disp}\n{kw_line}\nAt: {ev_str}\n{'='*30}\n")

    fig.canvas.mpl_connect('motion_notify_event', on_hover)
    fig.canvas.mpl_connect('button_press_event', on_click)
    fig.canvas.mpl_connect('key_press_event', on_key_press)
    fig.canvas.mpl_connect('key_release_event', on_key_release)

    print("Visualizations generated.")
    plt.tight_layout()
    plt.subplots_adjust(left=0.06, right=0.98, top=0.98, bottom=0.08)

    if has_student_data:
        _pos3 = ax3.get_position()
        _btn_sz = 0.035
        _ax_shake = fig.add_axes([
            _pos3.x1 - _btn_sz - 0.005,
            _pos3.y0 + 0.005,
            _btn_sz, _btn_sz,
        ], frameon=False)
        _ax_shake.set_xlim(0, 1)
        _ax_shake.set_ylim(0, 1)
        _ax_shake.set_xticks([])
        _ax_shake.set_yticks([])
        _shake_bg = mpatches.FancyBboxPatch(
            (0.05, 0.05), 0.9, 0.9,
            boxstyle='round,pad=0.1', color='#BDBDBD', zorder=1,
            transform=_ax_shake.transAxes,
        )
        _ax_shake.add_patch(_shake_bg)
        _ax_shake.text(
            0.5, 0.5, '🎲', ha='center', va='center', fontsize=16,
            fontfamily=['Segoe UI Emoji', 'DejaVu Sans'],
            transform=_ax_shake.transAxes, zorder=2,
        )

        _jitter_state = {'active': False}

        def _on_shake(evt):
            if evt.inaxes != _ax_shake:
                return
            _clear_highlight()
            _jitter_state['active'] = not _jitter_state['active']
            _shake_bg.set_facecolor('#FFB74D' if _jitter_state['active'] else '#BDBDBD')
            _student_new_y = {}
            for sa in student_artists:
                if _jitter_state['active']:
                    sa['x'] = _jitter_x(sa['x_orig'])
                    sa['y'] = _jitter_y(sa['y_orig'])
                else:
                    sa['x'] = sa['x_orig']
                    sa['y'] = sa['y_orig']
                _xn = mdates.date2num(sa['x'])
                sa['scatter'].set_offsets([[_xn, sa['y']]])
                for _h in sa.get('halos', []):
                    _h.set_offsets([[_xn, sa['y']]])
                _student_new_y[sa['data']['name']] = sa['y']
            _jitter_x_days = Config.DOT_JITTER_X_SECONDS / 86400
            for fb in follow_bar_artists:
                new_y_center = _student_new_y.get(fb['name'], fb['y_center'])
                dy = new_y_center - fb['y_center']
                fb['rect'].set_y(fb['y0_orig'] + dy)
                if _jitter_state['active']:
                    dx = random.uniform(-_jitter_x_days, _jitter_x_days)
                    fb['rect'].set_x(fb['x0_orig'] + dx)
                else:
                    fb['rect'].set_x(fb['x0_orig'])
            fig.canvas.draw_idle()

        fig._shake_conn = fig.canvas.mpl_connect('button_press_event', _on_shake)
        fig._shake_ax = _ax_shake

    return fig
