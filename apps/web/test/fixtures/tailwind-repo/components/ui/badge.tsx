import { cn } from '@/lib/utils';

export function Badge({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span className={cn('rounded-full bg-muted px-2.5 py-0.5 text-xs', className)} {...props} />
  );
}
