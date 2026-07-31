import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import Scanner from './Scanner';

describe('Scanner page', () => {
  it('offers an accessible private capture workflow with a file fallback', () => {
    const { container } = render(<MemoryRouter><Scanner /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: /bring a real board/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Game and board size')).toBeInTheDocument();
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).toHaveAttribute('accept', 'image/*');
    expect(input).toHaveAttribute('capture', 'environment');
    expect(screen.getByText(/photos never leave the browser/i)).toBeInTheDocument();
  });
});
