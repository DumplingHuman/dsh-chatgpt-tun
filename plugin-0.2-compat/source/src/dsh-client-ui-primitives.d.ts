declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { ButtonHTMLAttributes, ComponentType, ReactElement, ReactNode } from 'react'

  export interface DshButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'ghost' | 'outline' | 'toolbar'
    size?: 'md' | 'sm'
    icon?: ReactNode
  }

  export interface DshTooltipProps {
    label: ReactNode | (() => ReactNode)
    side?: 'right' | 'top' | 'bottom'
    delayMs?: number
    disabled?: boolean
    maxWidth?: number | string
    children: ReactElement
  }

  export const Button: ComponentType<DshButtonProps>
  export const Tooltip: ComponentType<DshTooltipProps>
  export const StateDot: ComponentType<{ state: 'ongoing' | 'done' | 'warning' | 'error'; size?: number; className?: string }>
  export const IconCodeOutline16: ComponentType<{ size?: number; className?: string }>
  export const IconChevronDownOutline14: ComponentType<{ size?: number; className?: string }>
  export const IconChevronRightOutline14: ComponentType<{ size?: number; className?: string }>
  export const IconChevronUpOutline14: ComponentType<{ size?: number; className?: string }>
  export const IconWarningOutline16: ComponentType<{ size?: number; className?: string }>

  // DSH 0.2.x icon set: size moved from the name into the `size` prop and the
  // numeric suffix became a Regular/Medium weight variant.
  export const IconCodeOutline: ComponentType<{ size?: number; className?: string }>
  export const IconCodeOutlineRegular: ComponentType<{ size?: number; className?: string }>
  export const IconCodeOutlineMedium: ComponentType<{ size?: number; className?: string }>
  export const IconChevronDownOutline: ComponentType<{ size?: number; className?: string }>
  export const IconChevronDownOutlineRegular: ComponentType<{ size?: number; className?: string }>
  export const IconChevronDownOutlineMedium: ComponentType<{ size?: number; className?: string }>
  export const IconChevronRightOutline: ComponentType<{ size?: number; className?: string }>
  export const IconChevronRightOutlineRegular: ComponentType<{ size?: number; className?: string }>
  export const IconChevronRightOutlineMedium: ComponentType<{ size?: number; className?: string }>
  export const IconChevronUpOutline: ComponentType<{ size?: number; className?: string }>
  export const IconChevronUpOutlineRegular: ComponentType<{ size?: number; className?: string }>
  export const IconChevronUpOutlineMedium: ComponentType<{ size?: number; className?: string }>
  export const IconWarningOutline: ComponentType<{ size?: number; className?: string }>
  export const IconWarningOutlineRegular: ComponentType<{ size?: number; className?: string }>
  export const IconWarningOutlineMedium: ComponentType<{ size?: number; className?: string }>
}
