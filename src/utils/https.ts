import * as https from 'https'

export const getURLContent = (url: string): Promise<string> =>
    new Promise((resolve, reject) => {
        https.get(url, (response) => {
            let content = ''

            response
                .on('data', (chunk) => (content += chunk))
                .on('end', () => resolve(content))
                .on('error', (err) => reject(err))
        })
    })
