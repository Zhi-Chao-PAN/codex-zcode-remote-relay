import argparse
from pathlib import Path
from urllib.parse import urlparse

import cv2


def parse_args():
    parser = argparse.ArgumentParser(description="Decode a ZCode remote QR screenshot into .env.local.")
    parser.add_argument("--image", required=True, help="Path to the QR screenshot.")
    parser.add_argument(
        "--env",
        default=str(Path.home() / ".codex" / "zcode-remote-relay" / ".env.local"),
        help="Destination env file.",
    )
    return parser.parse_args()


def set_env_value(text, key, value):
    lines = text.splitlines()
    replaced = False
    output = []
    for line in lines:
        if line.startswith(f"{key}="):
            output.append(f"{key}={value}")
            replaced = True
        else:
            output.append(line)
    if not replaced:
        output.append(f"{key}={value}")
    return "\n".join(output).rstrip() + "\n"


def main():
    args = parse_args()
    image_path = Path(args.image)
    env_path = Path(args.env)
    env_path.parent.mkdir(parents=True, exist_ok=True)

    image = cv2.imread(str(image_path))
    if image is None:
        raise SystemExit(f"Cannot read image: {image_path}")

    detector = cv2.QRCodeDetector()
    url, _, _ = detector.detectAndDecode(image)
    if not url:
        raise SystemExit("No QR code URL found in image.")

    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.netloc != "zcode.z.ai" or not parsed.path.startswith("/remote/v3"):
        raise SystemExit("QR code is not a ZCode remote URL.")

    current = env_path.read_text(encoding="utf-8") if env_path.exists() else ""
    if not current.strip() and Path(".env.local.example").exists():
        current = Path(".env.local.example").read_text(encoding="utf-8")
    env_path.write_text(set_env_value(current, "ZCODE_REMOTE_URL", url), encoding="utf-8")
    print("ok: wrote ZCode remote URL to .env.local")


if __name__ == "__main__":
    main()
