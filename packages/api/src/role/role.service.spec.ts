import { describe, expect, it } from 'vitest';
import { RoleService } from './role.service';

/**
 * Unit tests for {@link RoleService.compilePattern} — the resource /
 * action pattern matcher used by {@link RoleService.validate}.
 *
 * Regression coverage for two historical bugs:
 *
 *   1. The compiled regex was not anchored, so `workspace:prod` would
 *      also match `workspace:production` (silent privilege escalation).
 *   2. Regex metacharacters in the pattern were not escaped, so a
 *      resource name containing `.` would match any character.
 *
 * `compilePattern` is the only pure-function unit on this service —
 * everything else hits the DB/cache and is covered by integration
 * tests. Keeping these tests narrow keeps them fast (no DI container).
 */
describe('RoleService.compilePattern', () => {
  describe('exact match', () => {
    it('matches the exact resource name', () => {
      const regex = RoleService.compilePattern('workspace:prod');
      expect(regex.test('workspace:prod')).toBe(true);
    });

    it('does not match a resource that has the pattern as a prefix', () => {
      const regex = RoleService.compilePattern('workspace:prod');
      // This is the headline bug — without `$` anchoring, `prod`
      // would happily match `production`.
      expect(regex.test('workspace:production')).toBe(false);
    });

    it('does not match a resource that has the pattern as a suffix', () => {
      const regex = RoleService.compilePattern('workspace:prod');
      expect(regex.test('my-workspace:prod')).toBe(false);
    });
  });

  describe('wildcard match', () => {
    it('matches everything when the pattern is a bare `*`', () => {
      const regex = RoleService.compilePattern('*');
      expect(regex.test('workspace:prod')).toBe(true);
      expect(regex.test('user:create')).toBe(true);
      expect(regex.test('')).toBe(true);
    });

    it('matches a suffix wildcard', () => {
      const regex = RoleService.compilePattern('workspace:prod-*');
      expect(regex.test('workspace:prod-eu')).toBe(true);
      expect(regex.test('workspace:prod-us-west-2')).toBe(true);
      // `prod-*` is anchored at the start — must begin with `workspace:prod-`.
      expect(regex.test('workspace:staging-eu')).toBe(false);
    });

    it('matches multiple wildcards in one pattern', () => {
      const regex = RoleService.compilePattern('workspace:*:env:*');
      expect(regex.test('workspace:prod:env:eu')).toBe(true);
      expect(regex.test('workspace::env:')).toBe(true);
      expect(regex.test('workspace:prod:env')).toBe(false);
    });
  });

  describe('metacharacter literalness', () => {
    it('treats `.` as a literal, not "any character"', () => {
      const regex = RoleService.compilePattern('workspace:prod.eu');
      expect(regex.test('workspace:prod.eu')).toBe(true);
      // Pre-fix, the bare `.` would have matched any single character.
      expect(regex.test('workspace:prod_eu')).toBe(false);
      expect(regex.test('workspace:prodXeu')).toBe(false);
    });

    it('escapes `+`, `?`, `(`, `)`, `[`, `]`, `{`, `}`, `^`, `$`, `|`, `\\`', () => {
      const literal = 'a+b?c(d)e[f]g{h}i^j$k|l\\m';
      const regex = RoleService.compilePattern(literal);
      expect(regex.test(literal)).toBe(true);
      // Any deviation should fail — pre-fix, several of these would
      // have been interpreted as regex operators.
      expect(regex.test('aabbccdeefggh ij k l m')).toBe(false);
      expect(regex.test('')).toBe(false);
    });

    it('anchors at both ends even with metacharacters present', () => {
      const regex = RoleService.compilePattern('a.b');
      expect(regex.test('a.b')).toBe(true);
      expect(regex.test('xa.b')).toBe(false);
      expect(regex.test('a.bx')).toBe(false);
    });
  });
});
