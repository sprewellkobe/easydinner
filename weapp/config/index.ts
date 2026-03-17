import { defineConfig } from '@tarojs/cli'

export default defineConfig({
  projectName: 'yuefan-weapp',
  date: '2026-3-13',
  designWidth: 750,
  deviceRatio: {
    640: 2.34 / 2,
    750: 1,
    375: 2,
    828: 1.81 / 2,
  },
  sourceRoot: 'src',
  outputRoot: `dist/weapp`,
  plugins: ['@tarojs/plugin-framework-react'],
  defineConstants: {
    API_BASE_URL: JSON.stringify(process.env.API_BASE_URL || 'https://www.kobesoft.top'),
  },
  copy: {
    patterns: [
      { from: 'src/assets/', to: 'dist/weapp/assets/' },
    ],
    options: {},
  },
  framework: 'react',
  compiler: 'webpack5',
  mini: {
    terser: {
      enable: true,
      config: {
        compress: {
          drop_console: false,
        },
      },
    },
    postcss: {
      pxtransform: {
        enable: true,
        config: {},
      },
      cssModules: {
        enable: false,
        config: {
          namingPattern: 'module',
          generateScopedName: '[name]__[local]___[hash:base64:5]',
        },
      },
    },
    miniCssExtractPluginOption: {
      ignoreOrder: true,
    },
  },
  h5: {
    publicPath: '/',
    staticDirectory: 'static',
    postcss: {
      autoprefixer: {
        enable: true,
        config: {},
      },
      cssModules: {
        enable: false,
        config: {
          namingPattern: 'module',
          generateScopedName: '[name]__[local]___[hash:base64:5]',
        },
      },
    },
  },
})
