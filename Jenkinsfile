pipeline {
    agent any

    options {
        timestamps()
        disableConcurrentBuilds()
    }

    triggers {
        // Keep the API responsive with a lightweight request, and poll GitHub
        // separately so only source changes trigger a Render deployment.
        cron('H/10 * * * *')
        pollSCM('H/5 * * * *')
    }

    stages {
        stage('Keep API responsive') {
            when {
                triggeredBy 'TimerTrigger'
            }
            steps {
                script {
                    if (isUnix()) {
                        sh 'curl --fail --silent --show-error --max-time 30 --output /dev/null https://mahi-voice-assist-api.onrender.com/'
                    } else {
                        bat 'curl.exe --fail --silent --show-error --max-time 30 --output NUL https://mahi-voice-assist-api.onrender.com/'
                    }
                }
            }
        }

        stage('Deploy to Render') {
            when {
                not {
                    triggeredBy 'TimerTrigger'
                }
            }
            steps {
                script {
                    withCredentials([
                        string(credentialsId: 'render-api-deploy-hook', variable: 'RENDER_API_DEPLOY_HOOK'),
                        string(credentialsId: 'render-web-deploy-hook', variable: 'RENDER_WEB_DEPLOY_HOOK')
                    ]) {
                        if (isUnix()) {
                            sh '''
                                set +x
                                curl --fail --silent --show-error --output /dev/null "$RENDER_API_DEPLOY_HOOK"
                                curl --fail --silent --show-error --output /dev/null "$RENDER_WEB_DEPLOY_HOOK"
                            '''
                        } else {
                            bat '''
                                @echo off
                                curl.exe --fail --silent --show-error --output NUL "%RENDER_API_DEPLOY_HOOK%"
                                if errorlevel 1 exit /b %errorlevel%
                                curl.exe --fail --silent --show-error --output NUL "%RENDER_WEB_DEPLOY_HOOK%"
                                if errorlevel 1 exit /b %errorlevel%
                            '''
                        }
                    }
                }
            }
        }
    }

    post {
        success {
            echo 'Render deploy hooks were triggered successfully.'
        }
        failure {
            echo 'A Render deploy hook failed. Check the Jenkins console and credential configuration.'
        }
    }
}
