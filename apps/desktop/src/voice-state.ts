import { reactive } from 'vue'

/**
 * Voice state the chat box and the model settings share: whether she speaks her replies, and whether the voice
 * settings sheet is open. It always starts muted, including a restart on a remote workstation.
 */
export const voiceState = reactive({ enabled: false, settingsOpen: false })
