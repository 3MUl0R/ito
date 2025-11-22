import { useEffect } from 'react'
import { useMainStore } from '@/app/store/useMainStore'
import { useAppMode } from '@/app/store/useAppModeStore'
import GeneralSettingsContent from './settings/GeneralSettingsContent'
import AudioSettingsContent from './settings/AudioSettingsContent'
import AccountSettingsContent from './settings/AccountSettingsContent'
import KeyboardSettingsContent from './settings/KeyboardSettingsContent'
import AdvancedSettingsContent from './settings/AdvancedSettingsContent'
import PricingBillingSettingsContent from './settings/PricingBillingSettingsContent'
import TranscriptionSettingsContent from './settings/TranscriptionSettingsContent'

// Pages that are only available in specific modes
const CLOUD_ONLY_PAGES = ['pricing-billing', 'account'] as const
const LOCAL_ONLY_PAGES = ['transcription'] as const

export default function SettingsContent() {
  const { settingsPage, setSettingsPage } = useMainStore()
  const { isLocal } = useAppMode()

  // Redirect to 'general' if current page is not available in current mode
  useEffect(() => {
    if (isLocal && CLOUD_ONLY_PAGES.includes(settingsPage as any)) {
      setSettingsPage('general')
    } else if (!isLocal && LOCAL_ONLY_PAGES.includes(settingsPage as any)) {
      setSettingsPage('general')
    }
  }, [isLocal, settingsPage, setSettingsPage])

  // Build menu items based on mode
  const settingsMenuItems = [
    { id: 'general', label: 'General', active: settingsPage === 'general' },
    { id: 'keyboard', label: 'Keyboard', active: settingsPage === 'keyboard' },
    { id: 'audio', label: 'Audio & Mic', active: settingsPage === 'audio' },
    // Local mode: show Transcription settings
    ...(isLocal
      ? [{ id: 'transcription', label: 'Transcription', active: settingsPage === 'transcription' }]
      : []),
    // Cloud mode: show Pricing & Billing and Account
    ...(!isLocal
      ? [
          {
            id: 'pricing-billing',
            label: 'Pricing & Billing',
            active: settingsPage === 'pricing-billing',
          },
          { id: 'account', label: 'Account', active: settingsPage === 'account' },
        ]
      : []),
    { id: 'advanced', label: 'Advanced', active: settingsPage === 'advanced' },
  ]

  const renderSettingsContent = () => {
    switch (settingsPage) {
      case 'general':
        return <GeneralSettingsContent />
      case 'keyboard':
        return <KeyboardSettingsContent />
      case 'audio':
        return <AudioSettingsContent />
      case 'transcription':
        return <TranscriptionSettingsContent />
      case 'pricing-billing':
        return <PricingBillingSettingsContent />
      case 'account':
        return <AccountSettingsContent />
      case 'advanced':
        return <AdvancedSettingsContent />
      default:
        return <GeneralSettingsContent />
    }
  }

  return (
    <div className="w-full px-32">
      <div className="space-y-6">
        {/* Horizontal Tab/Pill Selector */}
        <div className="flex gap-1 p-1 bg-slate-100 rounded-lg w-fit mx-auto">
          {settingsMenuItems.map(item => (
            <button
              key={item.id}
              onClick={() => setSettingsPage(item.id as any)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
                item.active
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div className="w-full pt-8">{renderSettingsContent()}</div>
      </div>
    </div>
  )
}
