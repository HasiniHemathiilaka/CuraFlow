pipeline {
    agent any

    stages {
        stage('Checkout Code') {
            steps {
                checkout scm
            }
        }

        stage('Backend Validation') {
            steps {
                dir('curaflow-backend') {
                    // Using standard shell execution strings
                    sh 'npm install'
                }
            }
        }

        stage('Frontend Compilation Check') {
            steps {
                dir('curaflow-frontend') {
                    sh 'npm install'
                    sh 'npm run build'
                }
            }
        }

        stage('Assemble Production Containers') {
            steps {
                // Verifies your Docker layout maps cleanly without errors
                sh 'docker compose build --parallel'
            }
        }
    }

    post {
        always {
            cleanWs()
        }
        success {
            echo '🚀 CuraFlow CI Layer verification completed successfully!'
        }
        failure {
            echo '❌ Pipeline validation breakdown detected.'
        }
    }
}