export default defineAppConfig({
  lazyCodeLoading: 'requiredComponents',
  pages: [
    'pages/index/index',
    'pages/gathering/index',
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#ff6b35',
    navigationBarTitleText: '约饭',
    navigationBarTextStyle: 'white',
    backgroundColor: '#FFF5EE',
  },
  requiredPrivateInfos: [
    'chooseLocation',
    'getLocation',
  ],
  permission: {
    'scope.userLocation': {
      desc: '用于选择聚餐地点',
    },
  },
})
