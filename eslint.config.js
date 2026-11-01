import antfu from '@antfu/eslint-config'

export default antfu({ ignores: ['assets/**', 'dist/**', 'artifacts/**', 'materials/**', 'demos/**', '.remember/**', 'website/dist/**'], vue: true, typescript: true }, { rules: { 'style/max-statements-per-line': 'off', 'vue/max-attributes-per-line': 'off', 'vue/singleline-html-element-content-newline': 'off' } })
