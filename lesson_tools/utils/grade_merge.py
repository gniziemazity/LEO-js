from pathlib import Path

from openpyxl import load_workbook

from .similarity_measures import save_xlsx


def merge_existing_grades(current_dir: Path, folder_name: str, grades_path: Path) -> None:
    existing = sorted(
        (p for p in current_dir.glob(f'grades_{folder_name}_*.xlsx') if p != grades_path),
        key=lambda p: p.stat().st_mtime, reverse=True,
    )
    if not existing:
        return
    try:
        src_wb = load_workbook(existing[0])
        dst_wb = load_workbook(grades_path)
        sheet = 'Remarks'
        if sheet not in src_wb.sheetnames or sheet not in dst_wb.sheetnames:
            return
        src_ws, dst_ws = src_wb[sheet], dst_wb[sheet]

        def _hdr(ws, *names):
            return {c.value: c.column for c in ws[1] if c.value in names}

        src_c = _hdr(src_ws, 'Obs', 'Grade', 'Comments')
        dst_c = _hdr(dst_ws, 'Obs', 'Grade', 'Comments')
        if not (src_c and dst_c):
            return

        src_map = {
            str(row[0].value): {n: row[col - 1] for n, col in src_c.items()}
            for row in src_ws.iter_rows(min_row=2)
            if row[0].value is not None
        }
        for row in dst_ws.iter_rows(min_row=2):
            sid = str(row[0].value) if row[0].value is not None else None
            if sid not in src_map:
                continue
            for name, dst_col in dst_c.items():
                sc = src_map[sid].get(name)
                if sc is None:
                    continue
                dc = row[dst_col - 1]
                dc.value = sc.value
                if sc.has_style:
                    import copy

                    dc.font = copy.copy(sc.font)
                    dc.fill = copy.copy(sc.fill)
                    dc.border = copy.copy(sc.border)
                    dc.alignment = copy.copy(sc.alignment)
                    dc.number_format = sc.number_format

        save_xlsx(dst_wb, str(grades_path), vml_source=str(grades_path))
        print(f'  Merged grades from: {existing[0].name}')
        existing[0].unlink()
        print(f'  Deleted: {existing[0].name}')
    except Exception as e:
        print(f'  Warning: could not merge existing grades: {e}')
