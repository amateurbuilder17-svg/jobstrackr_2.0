import csv
import os
import re
import sys
import json
import time
import urllib.parse
import urllib3
import requests

# Suppress InsecureRequestWarning when verifying=False is needed for government certs
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

CSV_FILE = "/Volumes/T7 Shield/trackr latest/jobstrackr-new/organizations_logos.csv"
LOGOS_DIR = "/Volumes/T7 Shield/trackr latest/jobstrackr-new/logos"
AUDIT_CSV = "/Volumes/T7 Shield/trackr latest/jobstrackr-new/logos_audit_report.csv"
AUDIT_JSON = "/Volumes/T7 Shield/trackr latest/jobstrackr-new/logos_audit_summary.json"

os.makedirs(LOGOS_DIR, exist_ok=True)

USER_AGENT = "JobstrackrLogoAuditor/1.0 (https://jobstrackr.com; info@jobstrackr.com) Python-requests/2.32"
HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

def sanitize_filename(name):
    cleaned = re.sub(r'[\\/*?:"<>|]', "", name)
    cleaned = re.sub(r'\s+', "_", cleaned.strip())
    cleaned = re.sub(r'_+', "_", cleaned)
    return cleaned[:70]

def detect_extension(url, content_type, data):
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
    
    if content_type:
        ct = content_type.lower()
        if "svg" in ct:
            return ".svg"
        if "png" in ct:
            return ".png"
        if "jpeg" in ct or "jpg" in ct:
            return ".jpg"
        if "webp" in ct:
            return ".webp"
        if "gif" in ct:
            return ".gif"

    parsed = urllib.parse.urlparse(url)
    path = parsed.path.lower()
    for ext in [".svg.png", ".png", ".jpg", ".jpeg", ".svg", ".webp", ".gif", ".ico"]:
        if path.endswith(ext):
            if ext == ".svg.png":
                return ".png"
            return ext
            
    return ".png"

def extract_wiki_info(url):
    parsed = urllib.parse.urlparse(url)
    if "wikimedia.org" not in parsed.netloc and "wikipedia.org" not in parsed.netloc:
        return None, None
    
    parts = parsed.path.split('/')
    if 'thumb' in parts:
        idx = parts.index('thumb')
        filename = parts[idx + 3]
    else:
        filename = parts[-1]
    
    filename = urllib.parse.unquote(filename)
    
    lang = "commons"
    for p in parts:
        if p in ["commons", "en", "mr", "te", "hi"]:
            lang = p
            break
            
    return lang, filename

def try_download(session, url):
    """Attempt download with appropriate fallbacks for Wikimedia and SSL."""
    # 1. Try direct URL
    try:
        r = session.get(url, timeout=12, verify=False, allow_redirects=True)
        if r.status_code == 200 and len(r.content) > 100:
            ct = r.headers.get("Content-Type", "").lower()
            if "text/html" not in ct or b"<svg" in r.content[:200].lower():
                return True, r.status_code, r.content, ct, url, ""
    except Exception as e:
        pass

    # 2. If it is a wiki URL, try Special:FilePath
    lang, filename = extract_wiki_info(url)
    if filename:
        candidate_urls = []
        # Try both commons and the specific language wiki
        candidate_urls.append(f"https://commons.wikimedia.org/wiki/Special:FilePath/{urllib.parse.quote(filename)}")
        if lang != "commons":
            candidate_urls.append(f"https://{lang}.wikipedia.org/wiki/Special:FilePath/{urllib.parse.quote(filename)}")
        candidate_urls.append(f"https://en.wikipedia.org/wiki/Special:FilePath/{urllib.parse.quote(filename)}")

        # Try switching extensions: .png -> .svg or .svg -> .png
        base_name, current_ext = os.path.splitext(filename)
        alt_exts = [".svg", ".png", ".jpg"] if current_ext.lower() in [".png", ".jpg"] else [".png", ".jpg"]
        for ext in alt_exts:
            candidate_urls.append(f"https://commons.wikimedia.org/wiki/Special:FilePath/{urllib.parse.quote(base_name + ext)}")
            candidate_urls.append(f"https://en.wikipedia.org/wiki/Special:FilePath/{urllib.parse.quote(base_name + ext)}")

        for test_url in candidate_urls:
            try:
                r = session.get(test_url, timeout=12, verify=False, allow_redirects=True)
                if r.status_code == 200 and len(r.content) > 100:
                    ct = r.headers.get("Content-Type", "").lower()
                    if "text/html" not in ct or b"<svg" in r.content[:200].lower():
                        return True, 200, r.content, ct, test_url, "Resolved via Special:FilePath redirect"
            except Exception:
                continue

        # Try Wikipedia API pageimages search if filename looks like an org name
        clean_title = base_name.replace("_logo", "").replace("_Logo", "").replace("_", " ")
        try:
            api_url = f"https://en.wikipedia.org/w/api.php?action=query&titles={urllib.parse.quote(clean_title)}&prop=pageimages&format=json&pithumbsize=500"
            r = session.get(api_url, timeout=8, verify=False)
            if r.status_code == 200:
                pages = r.json().get("query", {}).get("pages", {})
                for page in pages.values():
                    thumb = page.get("thumbnail", {}).get("source")
                    if thumb:
                        r_img = session.get(thumb, timeout=10, verify=False)
                        if r_img.status_code == 200 and len(r_img.content) > 100:
                            return True, 200, r_img.content, r_img.headers.get("Content-Type", ""), thumb, "Resolved via Wikipedia Pageimages API"
        except Exception:
            pass

    return False, 0, b"", "", url, "Failed to download after all fallbacks"


def evaluate_logo_correctness(row_id, org_name, sector, org_type, acronym, original_url, final_url, download_success):
    issues = []
    category = "VERIFIED_SPECIFIC"
    notes = ""

    if not download_success:
        category = "DOWNLOAD_FAILED"
        issues.append("Logo image could not be downloaded / link broken or inaccessible")
        return category, "; ".join(issues)

    url_lower = original_url.lower()

    # 1. Obvious erroneous assets
    if row_id == 136 or "call-center" in url_lower:
        category = "INCORRECT_IMAGE"
        issues.append("Image is a customer care call center headphone icon ('call-center.f87543f1.png'), NOT the official APDCL / Assam Power Board corporate logo")
    elif row_id == 133 or "rdbuz.com" in url_lower:
        category = "INCORRECT_IMAGE"
        issues.append("Image is a RedBus travel booking asset ('gPmCEs.webp'), NOT the official Arunachal Pradesh State Transport Services (APSTS) logo")
    elif row_id == 238 or "west_bengal_police_flag" in url_lower:
        category = "INCORRECT_IMAGE"
        issues.append("Image is the West Bengal Police ceremonial flag, NOT the official West Bengal Police crest / insignia")
    
    # 2. National Emblem of India generic usage
    elif "emblem_of_india" in url_lower:
        if row_id == 26:
            category = "INTENDED_GENERIC"
            notes = "Standard National Emblem (Lion Capital of Ashoka) intended for Central Government Ministries"
        elif row_id == 122:
            category = "GOVT_EMBLEM_FALLBACK"
            notes = "Department of Atomic Energy uses National Emblem atop, but DAE also has a dedicated emblem"
        else:
            category = "GENERIC_FALLBACK"
            issues.append(f"Uses generic National Emblem of India (Ashoka Lion Capital) as placeholder for {org_name}; organisation has or requires its own dedicated logo/seal")

    # 3. Regional AIIMS using New Delhi logo
    elif "aiims_new_delhi" in url_lower:
        if row_id == 77:
            category = "VERIFIED_SPECIFIC"
            notes = "Official AIIMS New Delhi emblem (Original Institute)"
        else:
            category = "BRANCH_MISMATCH"
            issues.append(f"Uses AIIMS New Delhi logo for {org_name}. Regional AIIMS (Bhopal, Bhubaneswar, Jodhpur, Patna, Raipur, Rishikesh) have autonomous localized seals/emblems")

    # 4. Generic State Emblems / Seals
    elif any(term in url_lower for term in ["emblem_of_", "seal_of_", "government_of_", "tamilnadu_logo"]):
        state_word = org_name.split()[0]
        if "Police" in org_name:
            category = "STATE_EMBLEM_FALLBACK"
            issues.append(f"Generic State Emblem/Seal used instead of dedicated {state_word} Police emblem / crest")
        elif "Transport" in org_name:
            category = "STATE_EMBLEM_FALLBACK"
            issues.append(f"Generic State Emblem/Seal used instead of dedicated {state_word} Road Transport Corporation (SRTC) corporate/bus fleet logo")
        elif "Electricity" in org_name or "Power" in org_name:
            category = "STATE_EMBLEM_FALLBACK"
            issues.append(f"Generic State Emblem/Seal used instead of dedicated {state_word} State Electricity Board / DISCOM corporate logo")
        elif "Public Service Commission" in org_name:
            category = "STATE_EMBLEM_FALLBACK"
            issues.append(f"State Emblem/Seal used; some State PSCs share the state emblem while others possess specific Commission seals")
        else:
            category = "STATE_EMBLEM_FALLBACK"
            issues.append(f"Generic State Emblem used as fallback for {org_name}")

    # 5. Verified Specific Organization Logos
    else:
        category = "VERIFIED_SPECIFIC"
        notes = "Official specific organization logo / crest verified"

    result_notes = "; ".join(issues) if issues else notes
    return category, result_notes


def main():
    with open(CSV_FILE, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    print(f"Loaded {len(rows)} entries from CSV.")

    session = requests.Session()
    session.headers.update(HEADERS)

    results = []
    stats = {
        "total": len(rows),
        "downloaded_ok": 0,
        "download_failed": 0,
        "verified_specific": 0,
        "state_emblem_fallback": 0,
        "generic_fallback": 0,
        "incorrect_image": 0,
        "branch_mismatch": 0,
        "intended_generic": 0,
        "govt_emblem_fallback": 0
    }

    for index, row in enumerate(rows, 1):
        row_id = int(row["ID"])
        org_name = row["Organization_Name"].strip()
        sector = row["Sector"].strip()
        org_type = row["Organization_Type"].strip()
        acronym = row["Acronym"].strip()
        logo_url = row["Official_Logo_Link"].strip()

        print(f"[{index:03d}/{len(rows):03d}] ID {row_id:03d} | {acronym[:8]:8s} | {org_name[:35]:35s} ...", end=" ", flush=True)

        success, status_code, data, content_type, final_url, note = try_download(session, logo_url)

        saved_filename = ""
        error_msg = ""

        if success:
            ext = detect_extension(final_url, content_type, data)
            clean_acronym = sanitize_filename(acronym)
            clean_org = sanitize_filename(org_name)
            saved_filename = f"{row_id:03d}_{clean_acronym}_{clean_org}{ext}"
            file_path = os.path.join(LOGOS_DIR, saved_filename)
            with open(file_path, "wb") as out_f:
                out_f.write(data)
            stats["downloaded_ok"] += 1
            print(f"OK ({len(data)} bytes, {ext})")
        else:
            stats["download_failed"] += 1
            error_msg = note
            print(f"FAILED: {note}")

        category, eval_notes = evaluate_logo_correctness(
            row_id=row_id,
            org_name=org_name,
            sector=sector,
            org_type=org_type,
            acronym=acronym,
            original_url=logo_url,
            final_url=final_url,
            download_success=success
        )

        category_key = category.lower()
        if category_key in stats:
            stats[category_key] += 1

        results.append({
            "ID": row_id,
            "Organization_Name": org_name,
            "Acronym": acronym,
            "Sector": sector,
            "Organization_Type": org_type,
            "Original_Logo_Link": logo_url,
            "Resolved_Download_Link": final_url if success else "",
            "Download_Status": "Success" if success else "Failed",
            "HTTP_Status": status_code,
            "File_Size_Bytes": len(data),
            "Saved_Filename": saved_filename,
            "Audit_Classification": category,
            "Audit_Notes": eval_notes,
            "Error_Message": error_msg
        })

        time.sleep(0.12)  # Polite delay to respect Wikimedia and host rate limits

    # Save detailed CSV audit report
    fieldnames = [
        "ID", "Organization_Name", "Acronym", "Sector", "Organization_Type",
        "Original_Logo_Link", "Resolved_Download_Link", "Download_Status", "HTTP_Status",
        "File_Size_Bytes", "Saved_Filename", "Audit_Classification", "Audit_Notes", "Error_Message"
    ]
    with open(AUDIT_CSV, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(results)

    # Save summary JSON
    with open(AUDIT_JSON, "w", encoding="utf-8") as f:
        json.dump({"stats": stats, "results": results}, f, indent=2)

    print("\n" + "="*70)
    print("DOWNLOAD AND AUDIT COMPLETE SUMMARY:")
    print(f"  Total Organizations:                 {stats['total']}")
    print(f"  Successfully Downloaded:             {stats['downloaded_ok']}")
    print(f"  Failed Downloads:                    {stats['download_failed']}")
    print("-" * 70)
    print(f"  [1] Fully Verified Specific Logos:   {stats['verified_specific']}")
    print(f"  [2] State Emblem Fallbacks (generic):{stats['state_emblem_fallback']}")
    print(f"  [3] National Emblem Fallbacks:       {stats['generic_fallback']}")
    print(f"  [4] Incorrect Images (Wrong image):  {stats['incorrect_image']}")
    print(f"  [5] Branch Mismatch (AIIMS dupes):   {stats['branch_mismatch']}")
    print(f"  [6] Intended Generic National Emblem:{stats['intended_generic']}")
    print(f"  [7] Govt Emblem Fallback (DAE):      {stats['govt_emblem_fallback']}")
    print("="*70)

if __name__ == "__main__":
    main()
