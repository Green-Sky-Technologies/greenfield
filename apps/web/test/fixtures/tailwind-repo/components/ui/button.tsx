import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        outline: 'border border-input bg-background',
      },
    },
  },
);

export function Button({
  className,
  variant,
  ...props
}: React.ComponentProps<'button'> & { variant?: 'default' | 'outline' }) {
  return <button className={cn(buttonVariants({ variant }), className)} {...props} />;
}
