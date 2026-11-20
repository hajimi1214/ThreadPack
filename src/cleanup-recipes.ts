import { DEFAULT_OPTIONS } from './core';
import type { CleanOptions } from './core';

export type CleanupRecipeId = 'balanced' | 'share-safe' | 'keep-text';
type RecipeOptions = Omit<CleanOptions, 'customSecrets'>;

export const CLEANUP_RECIPES: Record<CleanupRecipeId, RecipeOptions> = {
  balanced: { ...DEFAULT_OPTIONS },
  'share-safe': { ...DEFAULT_OPTIONS, redactEmails: true },
  'keep-text': { ...DEFAULT_OPTIONS, trimToolOutputs: false, deduplicate: false },
};

const recipeFields = ['stripImages', 'trimToolOutputs', 'toolLimit', 'deduplicate', 'redact', 'redactEmails'] as const;

export function identifyCleanupRecipe(options: CleanOptions): CleanupRecipeId | null {
  for (const [id, recipe] of Object.entries(CLEANUP_RECIPES) as [CleanupRecipeId, RecipeOptions][]) {
    if (recipeFields.every(field => options[field] === recipe[field])) return id;
  }
  return null;
}

/** Apply a quick recipe while retaining the user's in-memory exact-value rules. */
export function applyCleanupRecipe(options: CleanOptions, recipe: CleanupRecipeId): CleanOptions {
  return { ...CLEANUP_RECIPES[recipe], customSecrets: options.customSecrets ? [...options.customSecrets] : [] };
}
