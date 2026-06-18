# Déploiement du Backend GeminiAtlas sur Alibaba Cloud

Ce document prouve la compatibilité du backend GeminiAtlas avec Alibaba Cloud, comme exigé par le hackathon Moonshot.

## 1. Architecture cible sur Alibaba Cloud

Pour la production, le backend de GeminiAtlas qui fait le proxy vers l'API Google Gemini peut être déployé sur : 
1.  `Function Compute FC` : Pour les appels API serverless, faible latence.
2.  `ECS Elastic Compute Service` : Pour héberger le service si besoin de GPU/CPU dédié.

## 2. Déploiement sur Function Compute FC - Exemple Node.js

Le backend `gemini-proxy.js` reçoit l'image + prompt depuis Snap Lens, puis appelle `Google Gemini API`.

**Étapes de déploiement :**

1.  **Installer Serverless Devs CLI**
    ```bash
    npm install @serverless-devs/s -g
    s config add
       edition: 3.0.0
    name: geminiAtlasApp
    access: default

    services:
      gemini-atlas-service:
        component: fc
        props:
          region: cn-hangzhou
          service:
            name: gemini-atlas-service
            description: 'Backend proxy pour GeminiAtlas Moonshot'
          function:
            name: geminiProxy
            description: 'Proxy vers Google Gemini API'
            runtime: nodejs18
            codeUri: ./backend
            handler: index.handler
            memorySize: 512
            timeout: 30
            environmentVariables:
              GEMINI_API_KEY: ${env(GEMINI_API_KEY)}
          triggers:
            - name: httpTrigger
              type: http
              config:
                authType: anonymous
                methods: [ 'POST', 'GET' ]
        s deploy
