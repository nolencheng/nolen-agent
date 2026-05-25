document.addEventListener('DOMContentLoaded', function() {
    console.log('网站已加载！');

    const cards = document.querySelectorAll('.card');
    cards.forEach((card, index) => {
        card.style.animation = `slideIn 0.6s ease-out ${index * 0.2}s both`;
    });
});
