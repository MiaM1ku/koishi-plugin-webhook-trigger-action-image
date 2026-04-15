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
	"C:/Windows/Fonts/seguiemj.ttf",
	"/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf",
	"/usr/share/fonts/noto-emoji/NotoColorEmoji.ttf",
	"/usr/share/fonts/google-noto-emoji/NotoColorEmoji.ttf",
	"/usr/share/fonts/truetype/noto/NotoEmoji-Regular.ttf",
	"/System/Library/Fonts/Apple Color Emoji.ttc",
];

function registerFonts(
	GlobalFonts: (typeof import("@napi-rs/canvas"))["GlobalFonts"]
) {
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

function fontStr(size: number, style?: "bold" | "italic" | "bold-italic"): string {
	const families: string[] = [];
	if (textFontRegistered) families.push(`"${TEXT_FONT_FAMILY}"`);
	if (emojiFontRegistered) families.push(`"${EMOJI_FONT_FAMILY}"`);
	families.push("sans-serif");
	const prefix =
		style === "bold" ? "bold " :
		style === "italic" ? "italic " :
		style === "bold-italic" ? "bold italic " : "";
	return `${prefix}${size}px ${families.join(", ")}`;
}

// ── Colors ────────────────────────────────────────────────
const COLORS = {
	bgGradStart: "#0d1117",
	bgGradEnd: "#161b22",
	cardBg: "#161b22",
	cardBorder: "#30363d",
	titleColor: "#58a6ff",
	sectionColor: "#f0883e",
	textColor: "#c9d1d9",
	mutedColor: "#8b949e",
	greenColor: "#7ee787",
	dividerColor: "#30363d",
	accentColor: "#1f6feb",
	codeBg: "#282c34",
	codeText: "#e06c75",
	quoteBorder: "#8b949e",
};

// ── Layout constants ──────────────────────────────────────
const WIDTH = 880;
const OUTER_PAD = 24;
const CARD_PAD = 32;
const LINE_HEIGHT = 28;
const CARD_RADIUS = 16;

// ── Markdown parsing ──────────────────────────────────────

type ParsedLine =
	| { type: "h1"; text: string }
	| { type: "h2"; text: string }
	| { type: "h3"; text: string }
	| { type: "hr" }
	| { type: "blockquote"; text: string }
	| { type: "ul-item"; text: string }
	| { type: "paragraph"; text: string }
	| { type: "empty" }
	// Legacy emoji types
	| { type: "emoji-title"; text: string }
	| { type: "emoji-section"; text: string }
	| { type: "emoji-stat"; text: string }
	| { type: "emoji-money"; text: string }
	| { type: "emoji-detail"; text: string };

function parseLine(raw: string): ParsedLine {
	const stripped = raw.trim();

	if (!stripped) return { type: "empty" };

	// Markdown headers
	const headerMatch = stripped.match(/^(#{1,3})\s+(.*)$/);
	if (headerMatch) {
		const level = headerMatch[1].length;
		const text = headerMatch[2];
		if (level === 1) return { type: "h1", text };
		if (level === 2) return { type: "h2", text };
		return { type: "h3", text };
	}

	// Horizontal rules
	if (/^(===+|---+|\*\*\*+)$/.test(stripped)) return { type: "hr" };

	// Blockquote
	const quoteMatch = stripped.match(/^>\s*(.*)$/);
	if (quoteMatch) return { type: "blockquote", text: quoteMatch[1] };

	// Unordered list
	const listMatch = stripped.match(/^[-*+]\s+(.*)$/);
	if (listMatch) return { type: "ul-item", text: listMatch[1] };

	// Legacy emoji types (backward compatibility)
	if (stripped.startsWith("📊")) return { type: "emoji-title", text: stripped };
	if (stripped.startsWith("🏆") || stripped.startsWith("👥")) return { type: "emoji-section", text: stripped };
	if (stripped.startsWith("🔢") || stripped.startsWith("🪙")) return { type: "emoji-stat", text: stripped };
	if (stripped.startsWith("💰")) return { type: "emoji-money", text: stripped };
	if (stripped.includes("·")) return { type: "emoji-detail", text: stripped };

	return { type: "paragraph", text: raw };
}

// ── Inline markdown ───────────────────────────────────────

type InlineSegment =
	| { style: "normal"; text: string }
	| { style: "bold"; text: string }
	| { style: "italic"; text: string }
	| { style: "bold-italic"; text: string }
	| { style: "code"; text: string };

/** Strip markdown backslash escapes: \. \- \| etc. → . - | */
function stripBackslashEscapes(s: string): string {
	return s.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, "$1");
}

function parseInlineSegments(text: string): InlineSegment[] {
	const segments: InlineSegment[] = [];
	const pattern = /`([^`]+)`|\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*/g;
	let lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(text)) !== null) {
		if (match.index > lastIndex) {
			segments.push({ style: "normal", text: stripBackslashEscapes(text.slice(lastIndex, match.index)) });
		}
		if (match[1] !== undefined) segments.push({ style: "code", text: match[1] });
		else if (match[2] !== undefined) segments.push({ style: "bold-italic", text: stripBackslashEscapes(match[2]) });
		else if (match[3] !== undefined) segments.push({ style: "bold", text: stripBackslashEscapes(match[3]) });
		else if (match[4] !== undefined) segments.push({ style: "italic", text: stripBackslashEscapes(match[4]) });
		lastIndex = pattern.lastIndex;
	}
	if (lastIndex < text.length) {
		segments.push({ style: "normal", text: stripBackslashEscapes(text.slice(lastIndex)) });
	}
	return segments.length > 0 ? segments : [{ style: "normal", text: stripBackslashEscapes(text) }];
}

// ── Canvas helpers ────────────────────────────────────────

function drawInlineSegments(
	ctx: any,
	segments: InlineSegment[],
	x: number,
	y: number,
	baseFontSize: number,
	defaultColor: string
) {
	let cursorX = x;
	for (const seg of segments) {
		switch (seg.style) {
			case "bold":
				ctx.font = fontStr(baseFontSize, "bold");
				ctx.fillStyle = defaultColor;
				ctx.fillText(seg.text, cursorX, y);
				cursorX += ctx.measureText(seg.text).width;
				break;
			case "italic":
				ctx.font = fontStr(baseFontSize, "italic");
				ctx.fillStyle = defaultColor;
				ctx.fillText(seg.text, cursorX, y);
				cursorX += ctx.measureText(seg.text).width;
				break;
			case "bold-italic":
				ctx.font = fontStr(baseFontSize, "bold-italic");
				ctx.fillStyle = defaultColor;
				ctx.fillText(seg.text, cursorX, y);
				cursorX += ctx.measureText(seg.text).width;
				break;
			case "code": {
				ctx.font = fontStr(baseFontSize - 1);
				const codeMetrics = ctx.measureText(seg.text);
				const padH = 5, padV = 3;
				// Code pill background
				ctx.fillStyle = COLORS.codeBg;
				ctx.beginPath();
				ctx.roundRect(cursorX - padH, y - padV, codeMetrics.width + padH * 2, baseFontSize + padV * 2, 4);
				ctx.fill();
				// Code text
				ctx.fillStyle = COLORS.codeText;
				ctx.fillText(seg.text, cursorX, y);
				cursorX += codeMetrics.width + padH * 2;
				break;
			}
			default:
				ctx.font = fontStr(baseFontSize);
				ctx.fillStyle = defaultColor;
				ctx.fillText(seg.text, cursorX, y);
				cursorX += ctx.measureText(seg.text).width;
				break;
		}
	}
}

/** Get the vertical space needed for a parsed line. */
function getLineHeight(line: ParsedLine): number {
	switch (line.type) {
		case "h1":
		case "emoji-title":
			return 42;
		case "h2":
		case "emoji-section":
			return 34;
		case "h3":
			return 30;
		case "hr":
			return 20;
		case "blockquote":
			return LINE_HEIGHT + 8;
		case "empty":
			return 12;
		default:
			return LINE_HEIGHT;
	}
}

// ── Image generation ──────────────────────────────────────

export async function generateReportImage(message: string): Promise<Buffer> {
	const { createCanvas } = await getCanvas();

	const lines = message.split("\n");
	const parsedLines = lines.map(parseLine);

	// ── Pass 1: measure total content height ──
	let contentHeight = 0;
	for (const pl of parsedLines) {
		contentHeight += getLineHeight(pl);
	}
	contentHeight += 16; // bottom accent line + padding

	const cardHeight = CARD_PAD * 2 + contentHeight + 3; // +3 for top accent bar
	const totalHeight = OUTER_PAD * 2 + cardHeight;

	// ── Create canvas ──
	const canvas = createCanvas(WIDTH, totalHeight);
	const ctx = canvas.getContext("2d");
	ctx.textBaseline = "top";

	// ── Background gradient ──
	const bgGrad = ctx.createLinearGradient(0, 0, 0, totalHeight);
	bgGrad.addColorStop(0, COLORS.bgGradStart);
	bgGrad.addColorStop(1, COLORS.bgGradEnd);
	ctx.fillStyle = bgGrad;
	ctx.fillRect(0, 0, WIDTH, totalHeight);

	// ── Card shadow ──
	ctx.save();
	ctx.shadowColor = "rgba(0,0,0,0.5)";
	ctx.shadowBlur = 20;
	ctx.shadowOffsetX = 0;
	ctx.shadowOffsetY = 4;
	ctx.fillStyle = COLORS.cardBg;
	ctx.beginPath();
	ctx.roundRect(OUTER_PAD, OUTER_PAD, WIDTH - OUTER_PAD * 2, cardHeight, CARD_RADIUS);
	ctx.fill();
	ctx.restore();

	// ── Card border ──
	ctx.strokeStyle = COLORS.cardBorder;
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.roundRect(OUTER_PAD, OUTER_PAD, WIDTH - OUTER_PAD * 2, cardHeight, CARD_RADIUS);
	ctx.stroke();

	// ── Top accent bar ──
	const topBarGrad = ctx.createLinearGradient(OUTER_PAD, OUTER_PAD, WIDTH - OUTER_PAD, OUTER_PAD);
	topBarGrad.addColorStop(0, COLORS.accentColor);
	topBarGrad.addColorStop(0.7, COLORS.accentColor);
	topBarGrad.addColorStop(1, "rgba(31,111,235,0)");
	ctx.save();
	ctx.fillStyle = topBarGrad;
	ctx.beginPath();
	ctx.roundRect(OUTER_PAD, OUTER_PAD, WIDTH - OUTER_PAD * 2, 3, [CARD_RADIUS, CARD_RADIUS, 0, 0]);
	ctx.fill();
	ctx.restore();

	// ── Pass 2: draw content ──
	const contentLeft = OUTER_PAD + CARD_PAD;
	const contentRight = WIDTH - OUTER_PAD - CARD_PAD;
	let y = OUTER_PAD + 3 + CARD_PAD; // after top accent bar

	for (const pl of parsedLines) {
		switch (pl.type) {
			case "h1":
			case "emoji-title": {
				const text = pl.text;
				// Left accent bar
				ctx.fillStyle = COLORS.accentColor;
				ctx.fillRect(contentLeft, y, 4, 30);
				ctx.font = fontStr(26, "bold");
				ctx.fillStyle = COLORS.titleColor;
				ctx.fillText(text, contentLeft + 14, y + 2);
				y += 42;
				break;
			}
			case "h2":
			case "emoji-section": {
				const text = pl.text;
				ctx.fillStyle = COLORS.sectionColor;
				ctx.fillRect(contentLeft, y, 4, 24);
				ctx.font = fontStr(20, "bold");
				ctx.fillText(text, contentLeft + 14, y + 2);
				y += 34;
				break;
			}
			case "h3": {
				ctx.font = fontStr(17, "bold");
				ctx.fillStyle = COLORS.textColor;
				ctx.fillText(pl.text, contentLeft + 8, y + 4);
				y += 30;
				break;
			}
			case "hr": {
				ctx.strokeStyle = COLORS.dividerColor;
				ctx.lineWidth = 1;
				ctx.beginPath();
				ctx.moveTo(contentLeft, y + 10);
				ctx.lineTo(contentRight, y + 10);
				ctx.stroke();
				y += 20;
				break;
			}
			case "blockquote": {
				// Quote background
				ctx.fillStyle = "rgba(139,148,158,0.06)";
				ctx.beginPath();
				ctx.roundRect(contentLeft + 4, y - 2, contentRight - contentLeft - 4, LINE_HEIGHT + 4, 4);
				ctx.fill();
				// Left bar
				ctx.fillStyle = COLORS.quoteBorder;
				ctx.fillRect(contentLeft + 4, y - 2, 3, LINE_HEIGHT + 4);
				// Text
				const segments = parseInlineSegments(pl.text);
				drawInlineSegments(ctx, segments, contentLeft + 18, y + 4, 16, COLORS.mutedColor);
				y += LINE_HEIGHT + 8;
				break;
			}
			case "ul-item": {
				// Bullet
				ctx.fillStyle = COLORS.accentColor;
				ctx.beginPath();
				ctx.arc(contentLeft + 18, y + 12, 3, 0, Math.PI * 2);
				ctx.fill();
				// Text with inline markdown
				const segments = parseInlineSegments(pl.text);
				drawInlineSegments(ctx, segments, contentLeft + 30, y + 4, 16, COLORS.textColor);
				y += LINE_HEIGHT;
				break;
			}
			case "emoji-stat": {
				ctx.font = fontStr(16);
				ctx.fillStyle = COLORS.textColor;
				ctx.fillText(pl.text, contentLeft + 8, y + 4);
				y += LINE_HEIGHT;
				break;
			}
			case "emoji-money": {
				ctx.font = fontStr(16);
				ctx.fillStyle = COLORS.greenColor;
				ctx.fillText(pl.text, contentLeft + 8, y + 4);
				y += LINE_HEIGHT;
				break;
			}
			case "emoji-detail": {
				ctx.font = fontStr(16);
				ctx.fillStyle = COLORS.mutedColor;
				ctx.fillText(pl.text, contentLeft + 48, y + 4);
				y += LINE_HEIGHT;
				break;
			}
			case "empty": {
				y += 12;
				break;
			}
			case "paragraph":
			default: {
				const text = "text" in pl ? pl.text : "";
				const segments = parseInlineSegments(text);
				drawInlineSegments(ctx, segments, contentLeft + 8, y + 4, 16, COLORS.textColor);
				y += LINE_HEIGHT;
				break;
			}
		}
	}

	// ── Bottom accent line ──
	y += 8;
	const bottomGrad = ctx.createLinearGradient(contentLeft, y, contentRight, y);
	bottomGrad.addColorStop(0, COLORS.accentColor);
	bottomGrad.addColorStop(1, "rgba(31,111,235,0)");
	ctx.strokeStyle = bottomGrad;
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.moveTo(contentLeft, y);
	ctx.lineTo(contentRight, y);
	ctx.stroke();

	return canvas.toBuffer("image/png");
}
