import { RouterProvider } from 'react-router';
import { Toaster, TooltipProvider } from '@/ui';
import { router } from './router';

export function App() {
  return (
    <TooltipProvider delayDuration={500} skipDelayDuration={300}>
      <RouterProvider router={router} />
      <Toaster />
    </TooltipProvider>
  );
}
