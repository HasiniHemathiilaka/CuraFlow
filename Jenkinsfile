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
                    // Changed 'sh' to 'bat' for Windows environment mapping
                    bat 'npm install'
                }
            }
        }

        stage('Frontend Compilation Check') {
            steps {
                dir('curaflow-frontend') {
                    bat 'npm install'
                    bat 'npm run build'
                }
            }
        }

        stage('Assemble Production Containers') {
            steps {
                // Verifies your Docker Compose topology via Windows CLI execution
                bat 'docker compose build --parallel'
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