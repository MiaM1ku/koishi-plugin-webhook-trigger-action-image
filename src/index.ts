import { Bot, Context, Schema, h } from "koishi";
import type {} from "@koishijs/plugin-server"
import { generateReportImage } from "./image";

export const name = "webhook-trigger-action";
export const inject = ["server"];
export interface responseType {
	platform: string;
	selfId: string;
	private: boolean;
	seeisonIds: string[];
	msg: string;
}

export enum WebhookMethodType {
	GET = "get",
	POST = "post",
}

export interface Webhook {
	method: WebhookMethodType;
	headers: { [key: string]: string };
	image: boolean;
	response?: responseType[];
}

export interface Config {
	[key: string]: Webhook;
}

export const Config = Schema.dict(
	Schema.object({
		method: Schema.union(Object.values(WebhookMethodType))
			.default(WebhookMethodType.GET)
			.description("监听方式"),
		headers: Schema.dict(Schema.string())
			.role("table")
			.description("检查头 如果填写则需要在请求头中包含"),
		image: Schema.boolean()
			.default(false)
			.description("是否以图片形式发送消息（将文本渲染为图片后发送）"),
		response: Schema.array(
			Schema.object({
				platform: Schema.union([
					"onebot",
					"qq",
					"kook",
					"telegram",
					"discord",
					"lark",
					"red",
				])
					.default("onebot")
					.description("平台"),
				username: Schema.string()
					.required()
					.description("机器人selfId，用于获取Bot对象"),
				private: Schema.boolean().default(false).description("是否私聊"),
				seeisonIds: Schema.array(Schema.string().required())
					.role("table")
					.description("群聊/私聊对象Id"),
				msg: Schema.string()
					.default("hello {name}")
					.role("textarea", { rows: [2, 4] })
					.description(
						"需要发送的信息，换行符请使用【\\n】或【\\<br \\/\\>】 <br>接收的body会按照JSON解析，并将key以{key}形式全替换字符串内容"
					),
			})
		).description("响应"),
	})
).description("监听指定路径<br/>修改配置后需要 **重启插件** 使更改生效");

export interface varDict {
	[key: string]: string;
}

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function flattenObject(obj: any, prefix = "", result: varDict = {}, depth = 0): varDict {
	if (depth > 10) return result;
	for (const key in obj) {
		if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
		const fullKey = prefix ? `${prefix}.${key}` : key;
		const value = obj[key];
		if (value !== null && typeof value === "object" && !Array.isArray(value)) {
			flattenObject(value, fullKey, result, depth + 1);
		} else if (Array.isArray(value)) {
			result[fullKey] = JSON.stringify(value);
			value.forEach((item, index) => {
				const indexedKey = `${fullKey}.${index}`;
				if (item !== null && typeof item === "object") {
					flattenObject(item, indexedKey, result, depth + 1);
				} else {
					result[indexedKey] = String(item ?? "");
				}
			});
		} else {
			result[fullKey] = String(value ?? "");
		}
	}
	return result;
}

async function sendResponseMsg(bot: Bot<any>, rep: responseType, rawDict: any, logger: any, image: boolean) {
	const dict = flattenObject(rawDict);
	let msg = rep.msg;
	for (const key in dict) {
		msg = msg.replace(new RegExp("\\{" + escapeRegex(key) + "\\}", "g"), dict[key]);
	}

	// Build the final message content
	let content: h[];
	if (image) {
		try {
			const pngBytes = await generateReportImage(msg.replace(/\\n/g, "\n"));
			const b64 = pngBytes.toString("base64");
			content = [h.image(`data:image/png;base64,${b64}`)];
		} catch (e) {
			logger.error("图片生成失败，回退到文本模式：" + e);
			content = [h.text(msg.replace(/\\n/g, "\n"))];
		}
	} else {
		content = [h.text(msg.replace(/\\n/g, "\n"))];
	}

	if (rep.private) {
		for (const sessionId of rep.seeisonIds) {
			await bot.sendPrivateMessage(sessionId, content);
		}
		return;
	}
	for (const sessionId of rep.seeisonIds) {
		await bot.sendMessage(sessionId, content);
	}
}

export function apply(ctx: Context, config: Config) {
	const logger = ctx.logger(name);


	for (let path in config) {
		let item = config[path];

		if (item.method === WebhookMethodType.GET)
			ctx.server.get(
					path,
					async (c, next) => {
						logger.info("接收到get请求：" + path);
						for (let httpheader in config[path].headers) {
							// 检查头，如果不相等则返回400
							if (c.header[httpheader.toLowerCase()] != config[path].headers[httpheader])
								return (c.status = 400);
						}
						await next();
					},
				async (c) => {
						let body = JSON.parse(JSON.stringify(c.request.query));
	
						for (const bot of ctx.bots) {
							logger.info("get请求 bot.selfId：" + bot.selfId);
							for (let rep of item.response ?? []) {
								if (bot.platform !== rep.platform || bot.selfId !== (rep as any).username) {
									// 过滤机器人平台，用户ID
									continue;
								}
								try {
									await sendResponseMsg(bot, rep, body ? body : {}, logger, item.image);
									c.status = 200;
									c.body = "OK";
								} catch (e) {
									logger.error("发送消息失败：" + e);
									c.status = 500;
									c.body = "Internal Server Error";
								}
								return;
							}
						}
	
						c.status = 405;
						c.body = "Method Not Allowed";
					}
			);

		if (item.method === WebhookMethodType.POST)
			ctx.server.post(
					path,
					async (c, next) => {
						logger.info("接收到post请求：" + path);
						for (let httpheader in config[path].headers) {
							// 检查头，如果不相等则返回400
							if (c.header[httpheader.toLowerCase()] != config[path].headers[httpheader])
								return (c.status = 400);
						}
						await next();
					},
				async (c) => {
						for (let bot of ctx.bots) {
							logger.info("post请求 bot.selfId：" + bot.selfId);
							for (let rep of item.response ?? []) {
								if (bot.platform !== rep.platform || bot.selfId !== (rep as any).username) {
									// 过滤机器人平台，用户ID
									continue;
								}
								try {
									await sendResponseMsg(
										bot,
										rep,
										c.request.body ? c.request.body : {},
										logger,
										item.image
									);
									c.status = 200;
									c.body = "OK";
								} catch (e) {
									logger.error("发送消息失败：" + e);
									c.status = 500;
									c.body = "Internal Server Error";
								}
								return;
							}
						}
						c.status = 405;
						c.body = "Method Not Allowed";
					}
			);
	}
}
