export interface SyntaxRule
{
    pattern: string;
    color: string;
}

interface CompiledLanguage
{
    regex: RegExp;
    colors: string[];
}

const LANGUAGE_REGISTRY = new Map<string, CompiledLanguage>();

export function registerLanguage(ext: string, rules: SyntaxRule[])
{
    LANGUAGE_REGISTRY.set(ext, {
        regex:  new RegExp(rules.map(r => `(${r.pattern})`).join("|"), "g"),
        colors: rules.map(r => r.color)
    });
}

export function getLanguage(ext: string)
{
    return LANGUAGE_REGISTRY.get(ext);
}