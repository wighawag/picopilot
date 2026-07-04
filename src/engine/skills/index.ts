/**
 * The skills-install engine behind `picopilot init --install-skills`, the one
 * picopilot path that writes to a shared/global location. Every install-target
 * knob is a parameter here so tests redirect it to a temp dir and the real agent
 * skill dirs stay byte-untouched. See `skills.ts` for the isolation contract.
 */
export {
  installSkills,
  type InstallSkillsOptions,
  type InstallSkillsResult,
  SKILL_NAMES,
  skillsSourceDir,
  type WiredAgent,
} from './skills.js'
