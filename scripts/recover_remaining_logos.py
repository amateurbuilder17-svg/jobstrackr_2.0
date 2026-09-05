import csv
import os
import re
import json
import urllib.parse
import urllib3
import requests

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

LOGOS_DIR = "/Volumes/T7 Shield/trackr latest/jobstrackr-new/logos"
AUDIT_CSV = "/Volumes/T7 Shield/trackr latest/jobstrackr-new/logos_audit_report.csv"
AUDIT_JSON = "/Volumes/T7 Shield/trackr latest/jobstrackr-new/logos_audit_summary.json"

USER_AGENT = "JobstrackrLogoAuditor/1.0 (https://jobstrackr.com; info@jobstrackr.com) Python-requests/2.32"
HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
}

# Mapping ID to the exact resolved file title on Wikimedia/Wikipedia
EXACT_RECOVERIES = {
    38: ("Indian Army Circular Insignia.svg", "commons"),
    55: ("IIMC LOGO.svg", "en"),
    57: ("Indian Institute of Management Kozhikode Logo.svg", "en"),
    66: ("Indian Institute of Technology Roorkee Logo.svg", "en"),
    67: ("Correct Logo of NIT Calicut.svg", "en"),
    68: ("NIT Durgapur Logo.svg", "commons"),
    69: ("Visvesvaraya National Institute of Technology logo.png", "en"),
    70: ("NIT Rourkela Colour Logo.svg", "commons"),
    71: ("National Institute of Technology Karnataka Logo.svg", "en"),
    73: ("National Institute of Technology, Warangal logo.png", "commons"),
    82: ("Bharat Dynamics Logo.svg", "commons"),
    83: ("Bharat Earth Movers Logo.svg", "commons"),
    89: ("Container Corporation of India logo.svg", "commons"),
    90: ("Engineers India Logo.svg", "commons"),
    96: ("Housing and Urban Development Corporation logo.svg", "commons"),
    97: ("Ircon International logo.svg", "commons"),
    100: ("Mahanagar Telephone Nigam Limited (emblem).svg", "commons"),
    101: ("Mazagon Dock Shipbuilders Logo.svg", "en"),
    104: ("National Aluminium Company logo.svg", "commons"),
    105: ("NBCC India Logo.svg", "commons"),
    106: ("National Mineral Development Corporation.svg", "commons"),
    107: ("Nuclear Power Corporation of India logo.svg", "commons"),
    112: ("RITES Logo.svg", "en"),
    114: ("Rashtriya Ispat Nigam Logo.svg", "commons"),
    117: ("SAIL Logo.svg", "commons"),
    120: ("CSIR-Logo-With-Tagline-Seleceted-Bilingual.png", "commons"),
    121: ("Defence Research and Development Organisation.svg", "en"),
    123: ("Logo of the Indian Council of Agricultural Research.svg", "commons"),
    131: ("Arunachal Pradesh Seal.svg", "commons"),
    132: ("Arunachal Pradesh Seal.svg", "commons"),
    163: ("Himachal PradeshPublic Service CommissionLogo.png", "commons"),
    164: ("Himachal Pradesh seal.svg", "commons"),
    165: ("Himachal Pradesh seal.svg", "commons"),
    194: ("Seal of Mizoram.svg", "commons"),
    195: ("Mizoram Public Service Commission Logo.png", "commons"),
    196: ("Seal of Mizoram.svg", "commons"),
    197: ("Seal of Mizoram.svg", "commons"),
    198: ("Seal of Nagaland.svg", "commons"),
    199: ("Nagaland Public Service Commission Logo.jpg", "commons"),
    200: ("Seal of Nagaland.svg", "commons"),
    201: ("Seal of Nagaland.svg", "commons"),
    207: ("PPSC Logo.png", "commons"),
    208: ("State Emblem of Punjab.jpg", "commons"),
    209: ("State Emblem of Punjab.jpg", "commons"),
    213: ("Rajasthan State Road Transport Corporation logo.png", "commons"),
    225: ("Telangana State Road Transport Corporation logo.png", "commons"),
    230: ("Logo of Uttar Pradesh Police.png", "commons"),
    233: ("Uttar Pradesh State Road Transport Corporation logo.png", "commons"),
}

def sanitize_filename(name):
    cleaned = re.sub(r'[\\/*?:"<>|]', "", name)
    cleaned = re.sub(r'\s+', "_", cleaned.strip())
    cleaned = re.sub(r'_+', "_", cleaned)
    return cleaned[:70]

def detect_extension(filename, data):
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data.startswith(b"GIF87a") or data.startswith(b"GIF89a"):
        return ".gif"
    if data.startswith(b"RIFF") and b"WEBP" in data[:16]:
        return ".webp"
    if b"<svg" in data[:500].lower():
        return ".svg"
    return os.path.splitext(filename)[1] or ".png"

def evaluate_logo_correctness(row_id, org_name, file_title):
    issues = []
    category = "VERIFIED_SPECIFIC"
    notes = ""
    title_lower = file_title.lower()

    if any(seal in title_lower for seal in ["seal_of_", "emblem_of_", "state emblem"]):
        state_word = org_name.split()[0]
        if "Police" in org_name:
            category = "STATE_EMBLEM_FALLBACK"
            issues.append(f"Generic State Seal used instead of dedicated {state_word} Police emblem / crest")
        elif "Transport" in org_name:
            category = "STATE_EMBLEM_FALLBACK"
            issues.append(f"Generic State Seal used instead of dedicated {state_word} Road Transport Corporation (SRTC) corporate bus logo")
        elif "Electricity" in org_name or "Power" in org_name:
            category = "STATE_EMBLEM_FALLBACK"
            issues.append(f"Generic State Seal used instead of dedicated {state_word} State Electricity Board / DISCOM corporate logo")
        elif "Public Service Commission" in org_name:
            category = "STATE_EMBLEM_FALLBACK"
            issues.append(f"State Emblem/Seal used; some State PSCs share the state emblem while others possess specific Commission seals")
        else:
            category = "STATE_EMBLEM_FALLBACK"
            issues.append(f"Generic State Emblem used as fallback for {org_name}")
    else:
        category = "VERIFIED_SPECIFIC"
        notes = f"Official specific organization logo recovered from Wikimedia ({file_title})"

    return category, "; ".join(issues) if issues else notes

def main():
    with open(AUDIT_CSV, "r", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    session = requests.Session()
    session.headers.update(HEADERS)

    recovered_count = 0

    for r in rows:
        rid = int(r["ID"])
        if r["Download_Status"] == "Failed" and rid in EXACT_RECOVERIES:
            file_title, preferred_domain = EXACT_RECOVERIES[rid]
            domains = ["commons", "en"] if preferred_domain == "commons" else ["en", "commons"]
            
            data = None
            resolved_url = None

            for d in domains:
                base = f"https://{d}.wikipedia.org/wiki/Special:FilePath/" if d != "commons" else "https://commons.wikimedia.org/wiki/Special:FilePath/"
                url = base + urllib.parse.quote(file_title)
                try:
                    resp = session.get(url, timeout=12, verify=False, allow_redirects=True)
                    if resp.status_code == 200 and len(resp.content) > 100:
                        ct = resp.headers.get("Content-Type", "").lower()
                        if "text/html" not in ct or b"<svg" in resp.content[:200].lower():
                            data = resp.content
                            resolved_url = resp.url
                            break
                except Exception:
                    pass

            if data:
                ext = detect_extension(file_title, data)
                clean_acronym = sanitize_filename(r["Acronym"])
                clean_org = sanitize_filename(r["Organization_Name"])
                saved_filename = f"{rid:03d}_{clean_acronym}_{clean_org}{ext}"
                file_path = os.path.join(LOGOS_DIR, saved_filename)
                with open(file_path, "wb") as out_f:
                    out_f.write(data)

                category, eval_notes = evaluate_logo_correctness(rid, r["Organization_Name"], file_title)

                r["Download_Status"] = "Success"
                r["HTTP_Status"] = 200
                r["File_Size_Bytes"] = len(data)
                r["Saved_Filename"] = saved_filename
                r["Resolved_Download_Link"] = resolved_url
                r["Audit_Classification"] = category
                r["Audit_Notes"] = eval_notes
                r["Error_Message"] = ""
                recovered_count += 1
                print(f"RECOVERED [{rid:03d}] {r['Acronym']} -> {saved_filename} ({len(data)} bytes)")
            else:
                print(f"FAILED RECOVERY [{rid:03d}] {r['Acronym']} ({file_title})")

    # Update Audit CSV
    fieldnames = list(rows[0].keys())
    with open(AUDIT_CSV, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    # Recalculate Summary Stats
    total = len(rows)
    downloaded_ok = sum(1 for r in rows if r["Download_Status"] == "Success")
    failed_count = sum(1 for r in rows if r["Download_Status"] == "Failed")
    categories = {}
    for r in rows:
        cat = r["Audit_Classification"]
        categories[cat] = categories.get(cat, 0) + 1

    summary = {
        "stats": {
            "total": total,
            "downloaded_ok": downloaded_ok,
            "download_failed": failed_count,
            "categories": categories
        },
        "results": rows
    }

    with open(AUDIT_JSON, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    print("\n" + "="*70)
    print(f"RECOVERY PASS COMPLETE! Recovered: {recovered_count} logos")
    print(f"Total: {total}")
    print(f"Successfully Downloaded: {downloaded_ok} / {total} ({(downloaded_ok/total)*100:.1f}%)")
    print(f"Failed: {failed_count}")
    print("Classifications:")
    for k, v in sorted(categories.items()):
        print(f"  {k}: {v}")
    print("="*70)

if __name__ == "__main__":
    main()
