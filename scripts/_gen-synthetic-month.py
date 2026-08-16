# 產生合成月度維修 Excel（供 CI 測試 import pipeline 用，不進版控）
# 欄位格式與每月作業表格一致：日期 | 型號 | 故障分類 | 維修結果 | 零件 ...
import sys
import datetime
from openpyxl import Workbook

out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/synthetic-month.xlsx"
month_label = sys.argv[2] if len(sys.argv) > 2 else "2026-08"

wb = Workbook()
ws = wb.active
ws.title = "維修記錄"
ws.append(["日期", "型號", "故障分類", "故障描述", "維修結果", "零件料號", "零件名稱", "是否報廢", "工單號"])
rows = [
    [f"{month_label}-03", "MD-2000", "無法開機", "電源板故障", "維修完成", "P-101", "電源模組A", "否", "WO-001"],
    [f"{month_label}-07", "MD-3000", "噪音異常", "風扇異音", "維修完成", "P-205", "散熱風扇", "否", "WO-002"],
    [f"{month_label}-11", "MD-2000", "漏液", "熱交換器滲漏", "報廢", "P-301", "熱交換器", "是", "WO-003"],
    [f"{month_label}-15", "MD-4000", "控制板異常", "面板無回應", "維修完成", "", "", "否", "WO-004"],
    [f"{month_label}-19", "MD-3000", "無法開機", "保險絲斷路", "維修完成", "P-110", "保險絲組", "否", "WO-005"],
]
for r in rows:
    ws.append(r)
wb.save(out)
print(f"wrote {out} ({len(rows)} records)")
