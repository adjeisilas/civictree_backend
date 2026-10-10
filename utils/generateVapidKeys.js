import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();

console.log('==================================================');
console.log('VAPID KEYS GENERATED SUCCESSFULLY');
console.log('==================================================');
console.log(`VAPID_PUBLIC_KEY="${keys.publicKey}"`);
console.log(`VAPID_PRIVATE_KEY="${keys.privateKey}"`);
console.log('==================================================');
console.log('Please copy these keys to your .env file.');
console.log('==================================================');
