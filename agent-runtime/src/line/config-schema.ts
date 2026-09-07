import { z } from "zod";

const DmPolicySchema = z.enum(["open", "allowlist", "pairing", "disabled"]);
const GroupPolicySchema = z.enum(["open", "allowlist", "disabled"]);

const RichMenuBoundsSchema = z
  .object({
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();

const RichMenuActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("message"), label: z.string(), text: z.string().optional() }).strict(),
  z.object({ type: z.literal("uri"), label: z.string(), uri: z.string() }).strict(),
  z
    .object({
      type: z.literal("postback"),
      label: z.string(),
      data: z.string(),
      displayText: z.string().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("datetimepicker"),
      label: z.string(),
      data: z.string(),
      mode: z.enum(["date", "time", "datetime"]),
      initial: z.string().optional(),
      min: z.string().optional(),
      max: z.string().optional(),
    })
    .strict(),
]);

export const LineRichMenuConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    name: z.string().optional(),
    chatBarText: z.string().optional(),
    height: z.union([z.literal(1686), z.literal(843)]).optional(),
    selected: z.boolean().optional(),
    imagePath: z.string().optional(),
    areas: z
      .array(z.object({ bounds: RichMenuBoundsSchema, action: RichMenuActionSchema }).strict())
      .optional(),
  })
  .strict();

const LineCommonConfigSchema = z.object({
  enabled: z.boolean().optional(),
  channelAccessToken: z.string().optional(),
  channelSecret: z.string().optional(),
  tokenFile: z.string().optional(),
  secretFile: z.string().optional(),
  name: z.string().optional(),
  allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
  groupAllowFrom: z.array(z.union([z.string(), z.number()])).optional(),
  dmPolicy: DmPolicySchema.optional().default("pairing"),
  groupPolicy: GroupPolicySchema.optional().default("allowlist"),
  responsePrefix: z.string().optional(),
  mediaMaxMb: z.number().optional(),
  webhookPath: z.string().optional(),
  richMenu: LineRichMenuConfigSchema.optional(),
});

const LineGroupConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    requireMention: z.boolean().optional(),
    systemPrompt: z.string().optional(),
    skills: z.array(z.string()).optional(),
  })
  .strict();

const LineAccountConfigSchema = LineCommonConfigSchema.extend({
  groups: z.record(z.string(), LineGroupConfigSchema.optional()).optional(),
}).strict();

export const LineConfigSchema = LineCommonConfigSchema.extend({
  accounts: z.record(z.string(), LineAccountConfigSchema.optional()).optional(),
  groups: z.record(z.string(), LineGroupConfigSchema.optional()).optional(),
}).strict();

export type LineConfigSchemaType = z.infer<typeof LineConfigSchema>;
