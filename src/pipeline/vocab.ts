// The fixed lists repo stats may name, kept free of Node so the collector validates with them.

export const FILE_SIZES = ['under_100', '100_999', '1k_9k', '10k_plus'] as const
export const AGES = ['under_3mo', '3_12mo', '1_3y', '3y_plus'] as const
export const HOSTS = ['none', 'github', 'gitlab', 'bitbucket', 'azure', 'other'] as const
export const LICENSES = ['permissive', 'copyleft', 'other', 'none'] as const
export const TEAMS = ['solo', '2_5', '6_20', '21_plus'] as const

/** Frameworks lore can recognize, by a file that only they leave or a dependency they need. */
export const FRAMEWORKS: [key: string, file?: RegExp, dep?: RegExp][] = [
  ['next', /(^|\/)next\.config\.[cm]?[jt]s$/, /"next"/],
  ['react', undefined, /"react"/],
  ['react-native', undefined, /"react-native"/],
  ['expo', /(^|\/)app\.json$/, /"expo"/],
  ['vue', undefined, /"vue"/],
  ['svelte', /(^|\/)svelte\.config\.[jt]s$/, /"svelte"/],
  ['angular', /(^|\/)angular\.json$/],
  ['express', undefined, /"express"/],
  ['nestjs', undefined, /"@nestjs\/core"/],
  ['electron', undefined, /"electron"/],
  ['tauri', /(^|\/)tauri\.conf\.json$/],
  ['django', /(^|\/)manage\.py$/, /\bdjango\b/i],
  ['fastapi', undefined, /\bfastapi\b/i],
  ['flask', undefined, /\bflask\b/i],
  ['rails', /(^|\/)config\/routes\.rb$/],
  ['laravel', /(^|\/)artisan$/, /laravel\/framework/],
  ['spring', undefined, /spring-boot|springframework/],
  ['dotnet', /\.(csproj|fsproj|sln)$/],
  ['flutter', undefined, /\bflutter:/],
  ['android', /(^|\/)AndroidManifest\.xml$/],
  ['ios', /\.xcodeproj\/project\.pbxproj$/],
  ['terraform', /\.tf$/],
  ['kubernetes', /(^|\/)(Chart\.yaml|kustomization\.ya?ml)$/],
]
