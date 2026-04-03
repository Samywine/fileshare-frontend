const awsConfig = {
  Auth: {
    Cognito: {
      userPoolId: "us-east-1_V1J5NEoSe",
      userPoolClientId: "7qmdmue2pkr8c73cgmsedlmhil",
      loginWith: {
        email: true
      }
    }
  },
  API: {
    GraphQL: {
      endpoint: "https://ga4mnxazezc6dcodscspliuvtq.appsync-api.us-east-1.amazonaws.com/graphql",
      region: "us-east-1",
      defaultAuthMode: "userPool"
    }
  }
};

export default awsConfig;