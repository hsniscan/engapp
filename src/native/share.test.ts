import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/router', () => ({ router: { navigate: vi.fn() } }));
const { openShared } = await import('./share');

describe('Android share intent → /share', () => {
  it('opens the share route with the text and title, once per intent', () => {
    const navigate = vi.fn(async () => {});
    const intent = { id: '1-1', text: 'https://example.com/a', title: 'A title' };
    openShared(intent, navigate);
    openShared(intent, navigate); // retained event delivered again
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(
      '/share?text=https%3A%2F%2Fexample.com%2Fa&title=A+title',
    );
    openShared({ id: '2-1', text: 'serendipity', title: '' }, navigate); // warm start, new share
    expect(navigate).toHaveBeenLastCalledWith('/share?text=serendipity');
  });
});
