pipeline {
    agent any

    options {
        timestamps()
        disableConcurrentBuilds()
    }

    triggers {
        // Useful when Jenkins is running locally and GitHub cannot reach it.
        // Jenkins builds only when SCM polling detects a change.
        pollSCM('H/5 * * * *')
    }

    stages {
        stage('Deploy to Render') {
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
