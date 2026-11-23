"""Independent QR decoding of local matrices; no network or camera access."""
import json
from pathlib import Path
try:
    import cv2
    import numpy as np
except ImportError as exc:
    print(json.dumps({"status": "NOT_RUN", "reason": str(exc)}))
    raise SystemExit(2)
root = Path(__file__).resolve().parent
results = []
for row in json.loads((root / 'aurora-qr-samples.json').read_text(encoding='utf-8')):
    data = np.array(row['matrix'], dtype=np.uint8)
    image = np.pad((1-data)*255, 4, constant_values=255)
    image = cv2.resize(image, None, fx=10, fy=10, interpolation=cv2.INTER_NEAREST)
    text, points, _ = cv2.QRCodeDetector().detectAndDecode(image)
    results.append({"status": "PASS" if text == row['text'] else "FAIL", "bytes": len(row['text'].encode()), "side": len(data)})
report = {"status": "PASS" if all(r['status'] == 'PASS' for r in results) else "FAIL", "decoder": "OpenCV", "cases": results}
(root / 'aurora-qr-decode-result.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
print(json.dumps(report))
raise SystemExit(0 if report['status'] == 'PASS' else 1)
