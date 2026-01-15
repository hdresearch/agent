// Skill management handlers

import type {
  SkillListResult,
  SkillGetParams,
  SkillGetResult,
  SkillSaveParams,
  SkillSaveResult,
  SkillDeleteParams,
  SkillDeleteResult,
  SkillInvokeParams,
  SkillInvokeResult,
} from "../../protocol/acp-types";
import { listSkills, getSkill, saveSkill, deleteSkill, buildSkillPrompt } from "../../utils/skill-store";

export async function handleSkillList(): Promise<SkillListResult> {
  const skills = await listSkills();
  return { skills };
}

export async function handleSkillGet(params: SkillGetParams): Promise<SkillGetResult> {
  const skill = await getSkill(params.name);
  return { skill };
}

export async function handleSkillSave(params: SkillSaveParams): Promise<SkillSaveResult> {
  const skill = await saveSkill({
    name: params.name,
    description: params.description,
    prompt: params.prompt,
    argsHint: params.argsHint,
  });
  return { skill };
}

export async function handleSkillDelete(params: SkillDeleteParams): Promise<SkillDeleteResult> {
  const deleted = await deleteSkill(params.name);
  return { deleted };
}

/**
 * Context for skill invoke - provides session prompt execution capability
 */
export interface SkillInvokeContext {
  executeSessionPrompt: (text: string) => Promise<void>;
}

/**
 * Invoke a skill by building its prompt and executing via session/prompt
 */
export async function handleSkillInvoke(
  params: SkillInvokeParams,
  context: SkillInvokeContext
): Promise<SkillInvokeResult> {
  const skill = await getSkill(params.name);
  if (!skill) {
    return { success: false, message: `Skill not found: ${params.name}` };
  }

  // Build the full prompt with skill instructions + user args
  const fullPrompt = buildSkillPrompt(skill, params.args);

  // Execute via session/prompt using the provided context
  await context.executeSessionPrompt(fullPrompt);

  return { success: true };
}
