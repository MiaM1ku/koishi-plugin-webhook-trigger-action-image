import { existsSync } from "node:fs";

// ── Lazy-load @napi-rs/canvas ─────────────────────────────
let _canvas: typeof import("@napi-rs/canvas") | null = null;

async function getCanvas(): Promise<typeof import("@napi-rs/canvas")> {
	if (_canvas) return _canvas;
	try {
		_canvas = await import("@napi-rs/canvas");
	} catch {
		throw new Error(
			"Image mode requires @napi-rs/canvas. Install it with: npm install @napi-rs/canvas"
		);
	}
	registerFonts(_canvas.GlobalFonts);
	return _canvas;
}

// ── Font registration ─────────────────────────────────────
const TEXT_FONT_FAMILY = "ReportFont";
const EMOJI_FONT_FAMILY = "EmojiFont";
let textFontRegistered = false;
let emojiFontRegistered = false;

const TEXT_FONT_CANDIDATES = [
	"C:/Windows/Fonts/msyh.ttc",
	"C:/Windows/Fonts/msyhbd.ttc",
	"C:/Windows/Fonts/simhei.ttf",
	"/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
	"/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
	"/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
	"/usr/share/fonts/truetype/noto/NotoSansSC-Regular.ttf",
	"/usr/share/fonts/opentype/noto/NotoSansSC-Regular.otf",
	"/System/Library/Fonts/PingFang.ttc",
];

const EMOJI_FONT_CANDIDATES = [
	// Windows
	"C:/Windows/Fonts/seguiemj.ttf",
	// Linux - Noto Color Emoji
	"/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf",
	"/usr/share/fonts/noto-emoji/NotoColorEmoji.ttf",
	"/usr/share/fonts/google-noto-emoji/NotoColorEmoji.ttf",
	"/usr/share/fonts/truetype/noto/NotoEmoji-Regular.ttf",
	// macOS
	"/System/Library/Fonts/Apple Color Emoji.ttc",
];

function registerFonts(
	GlobalFonts: (typeof import("@napi-rs/canvas"))["GlobalFonts"]
) {
	// Register text font
	if (!textFontRegistered) {
		for (const fontPath of TEXT_FONT_CANDIDATES) {
			try {
				if (existsSync(fontPath)) {
					GlobalFonts.registerFromPath(fontPath, TEXT_FONT_FAMILY);
					textFontRegistered = true;
					break;
				}
			} catch {
				continue;
			}
		}
	}

	// Register emoji font
	if (!emojiFontRegistered) {
		for (const fontPath of EMOJI_FONT_CANDIDATES) {
			try {
				if (existsSync(fontPath)) {
					GlobalFonts.registerFromPath(fontPath, EMOJI_FONT_FAMILY);
					emojiFontRegistered = true;
					break;
				}
			} catch {
				continue;
			}
		}
	}
}

function fontStr(size: number): string {
	const families: string[] = [];
	if (textFontRegistered) families.push(`"${TEXT_FONT_FAMILY}"`);
	if (emojiFontRegistered) families.push(`"${EMOJI_FONT_FAMILY}"`);
	families.push("sans-serif");
	return `${size}px ${families.join(", ")}`;
}

// ── Image generation ──────────────────────────────────────

/**
 * Parse the text message and render it as a dark-themed PNG image.
 * Returns raw PNG bytes as a Buffer.
 */
export async function generateReportImage(message: string): Promise<Buffer> {
	const { createCanvas } = await getCanvas();

	// Colors (dark theme)
	const BG = "#0d1117";
	const TITLE_CLR = "#58a6ff";
	const SECTION_CLR = "#f0883e";
	const TEXT_CLR = "#c9d1d9";
	const MUTED_CLR = "#8b949e";
	const GREEN_CLR = "#7ee787";
	const DIVIDER_CLR = "#30363d";
	const ACCENT_CLR = "#1f6feb";

	// Layout constants
	const WIDTH = 880;
	const PAD = 32;
	const LINE_HEIGHT = 24;

	const lines = message.split("\n");
	const estimatedHeight = PAD * 2 + LINE_HEIGHT * (lines.length + 5);

	// Create oversized canvas (crop later)
	const canvas = createCanvas(WIDTH, estimatedHeight);
	const ctx = canvas.getContext("2d");

	// Fill background
	ctx.fillStyle = BG;
	ctx.fillRect(0, 0, WIDTH, estimatedHeight);
	ctx.textBaseline = "top";

	let y = PAD;

	for (const line of lines) {
		const stripped = line.trim();

		if (stripped.startsWith("📊")) {
			// Title line
			ctx.fillStyle = ACCENT_CLR;
			ctx.fillRect(PAD, y, 4, 30);
			ctx.font = fontStr(26);
			ctx.fillStyle = TITLE_CLR;
			ctx.fillText(stripped, PAD + 14, y + 2);
			y += 38;
		} else if (
			stripped.length > 0 &&
			[...stripped].every((c) => c === "=" || c === "-")
		) {
			// Divider lines (=== or ---)
			ctx.strokeStyle = DIVIDER_CLR;
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.moveTo(PAD, y + 8);
			ctx.lineTo(WIDTH - PAD, y + 8);
			ctx.stroke();
			y += 18;
		} else if (stripped.startsWith("🏆") || stripped.startsWith("👥")) {
			// Section headers
			ctx.fillStyle = SECTION_CLR;
			ctx.fillRect(PAD, y, 4, 24);
			ctx.font = fontStr(16);
			ctx.fillText(stripped, PAD + 14, y + 4);
			y += LINE_HEIGHT + 6;
		} else if (stripped.startsWith("🔢") || stripped.startsWith("🪙")) {
			// Summary stats
			ctx.font = fontStr(16);
			ctx.fillStyle = TEXT_CLR;
			ctx.fillText(stripped, PAD + 8, y + 4);
			y += LINE_HEIGHT;
		} else if (stripped.startsWith("💰")) {
			// Money / value stats (green)
			ctx.font = fontStr(16);
			ctx.fillStyle = GREEN_CLR;
			ctx.fillText(stripped, PAD + 8, y + 4);
			y += LINE_HEIGHT;
		} else if (stripped.includes("·")) {
			// Detail lines (indented with ·)
			ctx.font = fontStr(16);
			ctx.fillStyle = MUTED_CLR;
			ctx.fillText(stripped, PAD + 48, y + 4);
			y += LINE_HEIGHT;
		} else if (!stripped) {
			// Empty lines
			y += 10;
		} else {
			// Normal text lines
			ctx.font = fontStr(16);
			ctx.fillStyle = TEXT_CLR;
			ctx.fillText(line, PAD + 8, y + 4);
			y += LINE_HEIGHT;
		}
	}

	// Bottom accent line
	y += 8;
	ctx.strokeStyle = ACCENT_CLR;
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.moveTo(PAD, y);
	ctx.lineTo(WIDTH - PAD, y);
	ctx.stroke();
	y += PAD;

	// Crop to actual content height and export as PNG
	const cropped = createCanvas(WIDTH, y);
	const croppedCtx = cropped.getContext("2d");
	croppedCtx.drawImage(canvas, 0, 0);

	return cropped.toBuffer("image/png");
}
