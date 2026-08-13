import { Check, ChevronsUpDown, Layers3 } from 'lucide-react'
import { type ProbeProfile } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

type ProfileMultiSelectProps = {
  profiles: ProbeProfile[]
  value: string[]
  onChange: (value: string[]) => void
  disabled?: boolean
  invalid?: boolean
  enabledOnly?: boolean
  placeholder?: string
}

export function ProfileMultiSelect({
  profiles,
  value,
  onChange,
  disabled = false,
  invalid = false,
  enabledOnly = false,
  placeholder = '选择探针方案',
}: ProfileMultiSelectProps) {
  const selectedIds = uniqueIds(value)
  const selectedIdSet = new Set(selectedIds)
  const selectedProfiles = selectedIds
    .map((id) => profiles.find((profile) => profile.id === id))
    .filter((profile): profile is ProbeProfile => profile != null)
  const selectableProfiles = profiles.filter(
    (profile) =>
      !enabledOnly || profile.enabled || selectedIdSet.has(profile.id)
  )
  const enabledIds = profiles
    .filter((profile) => profile.enabled)
    .map((profile) => profile.id)

  const toggle = (profile: ProbeProfile) => {
    if (!profile.enabled && !selectedIdSet.has(profile.id)) return
    onChange(
      selectedIdSet.has(profile.id)
        ? selectedIds.filter((id) => id !== profile.id)
        : [...selectedIds, profile.id]
    )
  }

  return (
    <div className='grid gap-2'>
      <Popover modal>
        <PopoverTrigger asChild>
          <Button
            type='button'
            variant='outline'
            role='combobox'
            aria-label='选择探针方案'
            aria-invalid={invalid || undefined}
            disabled={disabled}
            className={cn(
              'h-auto min-h-9 w-full justify-between px-3 py-2 font-normal',
              invalid && 'border-destructive focus-visible:ring-destructive/30'
            )}
          >
            <span className='flex min-w-0 items-center gap-2'>
              <Layers3 className='size-4 shrink-0 text-muted-foreground' />
              <span
                className={cn(
                  'truncate',
                  !selectedProfiles.length && 'text-muted-foreground'
                )}
              >
                {selectedProfiles.length === 0
                  ? placeholder
                  : selectedProfiles.length === 1
                    ? selectedProfiles[0].name
                    : `已选 ${selectedProfiles.length} 个方案`}
              </span>
            </span>
            <ChevronsUpDown className='size-4 shrink-0 text-muted-foreground' />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align='start'
          className='w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] p-0 sm:min-w-80'
        >
          <Command>
            <CommandInput placeholder='搜索名称、模型或方案 ID' />
            <div className='flex items-center justify-between gap-2 border-b px-3 py-2'>
              <span className='text-xs text-muted-foreground'>
                {selectedIds.length} / {enabledIds.length} 个已启用方案
              </span>
              <div className='flex items-center gap-1'>
                <Button
                  type='button'
                  size='sm'
                  variant='ghost'
                  className='h-7 px-2 text-xs'
                  disabled={!enabledIds.length}
                  onClick={() => onChange(enabledIds)}
                >
                  全选
                </Button>
                <Button
                  type='button'
                  size='sm'
                  variant='ghost'
                  className='h-7 px-2 text-xs'
                  disabled={!selectedIds.length}
                  onClick={() => onChange([])}
                >
                  清空
                </Button>
              </div>
            </div>
            <CommandList>
              <CommandEmpty>未找到探针方案</CommandEmpty>
              <CommandGroup>
                {selectableProfiles.map((profile) => {
                  const selected = selectedIdSet.has(profile.id)
                  return (
                    <CommandItem
                      key={profile.id}
                      value={`${profile.name} ${profile.model} ${profile.id}`}
                      disabled={!profile.enabled && !selected}
                      onSelect={() => toggle(profile)}
                    >
                      <span
                        className={cn(
                          'flex size-4 shrink-0 items-center justify-center rounded-sm border',
                          selected
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-muted-foreground/35'
                        )}
                        aria-hidden='true'
                      >
                        {selected && <Check className='size-3' />}
                      </span>
                      <span className='min-w-0 flex-1'>
                        <span className='block truncate'>{profile.name}</span>
                        <span className='block truncate text-xs text-muted-foreground'>
                          {profile.model}
                        </span>
                      </span>
                      {!profile.enabled && (
                        <Badge variant='secondary' className='shrink-0'>
                          停用
                        </Badge>
                      )}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selectedProfiles.length > 1 && (
        <div className='flex flex-wrap gap-1.5'>
          {selectedProfiles.slice(0, 4).map((profile) => (
            <Badge key={profile.id} variant='outline' className='max-w-52'>
              <span className='truncate'>{profile.name}</span>
            </Badge>
          ))}
          {selectedProfiles.length > 4 && (
            <Badge variant='secondary'>+{selectedProfiles.length - 4}</Badge>
          )}
        </div>
      )}
    </div>
  )
}

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)))
}
