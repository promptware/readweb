import { z } from 'zod';

export const PresetSchema = z
  .object({
    preset_match_detectors: z.array(z.string().min(1)).min(1),
    main_content_selectors: z.array(z.string().min(1)).min(1),
    main_content_filters: z.array(z.string().min(1)),
  })
  .strict();

export type Preset = z.infer<typeof PresetSchema>;

export function parsePreset(json: unknown): Preset {
  return PresetSchema.parse(json);
}



