import { describe, expect, it } from 'vitest';
import { camelCaseEmbeds } from './embed-case';

describe('camelCaseEmbeds', () => {
  it('camelCases keys inside a listed embed (array of objects)', () => {
    expect(
      camelCaseEmbeds(
        {
          workspaceId: 'w1',
          environments: [
            { environment_id: 'e1', workspace_id: 'w1', name: 'dev' },
            { environment_id: 'e2', workspace_id: 'w1', name: 'prod' },
          ],
        },
        ['environments']
      )
    ).toEqual({
      workspaceId: 'w1',
      environments: [
        { environmentId: 'e1', workspaceId: 'w1', name: 'dev' },
        { environmentId: 'e2', workspaceId: 'w1', name: 'prod' },
      ],
    });
  });

  it('camelCases keys inside a listed embed (plain object)', () => {
    expect(
      camelCaseEmbeds(
        {
          workspaceId: 'w1',
          createdByUser: { first_name: 'Lucas', last_name: 'Vieira' },
        },
        ['createdByUser']
      )
    ).toEqual({
      workspaceId: 'w1',
      createdByUser: { firstName: 'Lucas', lastName: 'Vieira' },
    });
  });

  it('leaves keys NOT in the embed list completely alone', () => {
    // metadata is not listed → its operator-supplied snake_case
    // keys must round-trip verbatim, even though the top-level
    // `metadata` key sits next to a listed embed.
    expect(
      camelCaseEmbeds(
        {
          auditId: 'a1',
          metadata: { user_id: 'u_42', team: 'growth' },
          environments: [{ environment_id: 'e1', name: 'dev' }],
        },
        ['environments']
      )
    ).toEqual({
      auditId: 'a1',
      metadata: { user_id: 'u_42', team: 'growth' },
      environments: [{ environmentId: 'e1', name: 'dev' }],
    });
  });

  it('recurses through nested embeds', () => {
    // An env that itself contains a `created_by_user` should have
    // both the env's own keys and the inner user's keys camelCased
    // when `environments` is listed.
    expect(
      camelCaseEmbeds(
        {
          environments: [
            {
              environment_id: 'e1',
              created_by_user: { first_name: 'Lucas' },
            },
          ],
        },
        ['environments']
      )
    ).toEqual({
      environments: [
        {
          environmentId: 'e1',
          createdByUser: { firstName: 'Lucas' },
        },
      ],
    });
  });

  it('handles a null embed value', () => {
    expect(
      camelCaseEmbeds({ workspaceId: 'w1', createdByUser: null }, [
        'createdByUser',
      ])
    ).toEqual({ workspaceId: 'w1', createdByUser: null });
  });

  it('preserves Date, primitives, and arrays of primitives within embeds', () => {
    const d = new Date('2026-01-01T00:00:00Z');
    expect(
      camelCaseEmbeds(
        {
          environments: [
            {
              environment_id: 'e1',
              created_at: d,
              description: null,
              tags: ['live', 'managed'],
            },
          ],
        },
        ['environments']
      )
    ).toEqual({
      environments: [
        {
          environmentId: 'e1',
          createdAt: d,
          description: null,
          tags: ['live', 'managed'],
        },
      ],
    });
  });

  it('returns a new object — does not mutate input', () => {
    const input = {
      environments: [{ environment_id: 'e1', name: 'dev' }],
    };
    camelCaseEmbeds(input, ['environments']);
    expect(input.environments[0]).toEqual({
      environment_id: 'e1',
      name: 'dev',
    });
  });
});
