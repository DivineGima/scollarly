/* ═══════════════════════════════════════════════
   SCOLLARLY - Interactive Script
   ═══════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', function () {

  // ─── Intro Overlay ───
  var introOverlay = document.getElementById('intro-overlay');
  if (introOverlay) {
    setTimeout(function () {
      introOverlay.classList.add('exit');
      setTimeout(function () {
        introOverlay.style.display = 'none';
      }, 600);
    }, 2800);
  }

  // ─── Mobile Menu Toggle ───
  var mobileToggle = document.getElementById('mobile-toggle');
  var mobileMenu = document.getElementById('mobile-menu');
  if (mobileToggle && mobileMenu) {
    mobileToggle.addEventListener('click', function () {
      mobileMenu.classList.toggle('open');
    });
    // Close menu when a link is clicked
    var mobileLinks = mobileMenu.querySelectorAll('a');
    mobileLinks.forEach(function (link) {
      link.addEventListener('click', function () {
        mobileMenu.classList.remove('open');
      });
    });
  }

  // ─── Scroll Reveal (Intersection Observer) ───
  var observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
  };

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        // Don't unobserve - keep it visible
      }
    });
  }, observerOptions);

  // Observe all animatable elements
  var animateSelectors = [
    '.section',
    '.section-header',
    '.stat-item',
    '.about-image-wrap',
    '.about-content',
    '.value-item',
    '.service-card',
    '.free-banner',
    '.timeline-step',
    '.process-cta',
    '.university-card',
    '.campus-image',
    '.visa-card',
    '.visa-note',
    '.faq-item',
    '.contact-info',
    '.contact-item',
    '.contact-form-card',
    '.cta-title',
    '.cta-subtitle',
    '.cta-buttons'
  ];

  animateSelectors.forEach(function (selector) {
    var elements = document.querySelectorAll(selector);
    elements.forEach(function (el) {
      observer.observe(el);
    });
  });

  // ─── FAQ Accordion ───
  var faqItems = document.querySelectorAll('.faq-item');
  faqItems.forEach(function (item) {
    var question = item.querySelector('.faq-question');
    if (question) {
      question.addEventListener('click', function () {
        // Close all other items
        faqItems.forEach(function (otherItem) {
          if (otherItem !== item) {
            otherItem.classList.remove('open');
          }
        });
        // Toggle current item
        item.classList.toggle('open');
      });
    }
  });

  // ─── Contact Form Submission ───
  var contactForm = document.getElementById('contact-form');
  var btnSubmit = document.getElementById('btn-submit');
  var btnSubmitText = document.getElementById('btn-submit-text');

  if (contactForm) {
    contactForm.addEventListener('submit', function (e) {
      e.preventDefault();

      if (btnSubmit) {
        btnSubmit.disabled = true;
        if (btnSubmitText) {
          btnSubmitText.textContent = 'Sending...';
        }
      }

      var formData = new FormData(contactForm);

      fetch('/api/contact', {
        method: 'POST',
        body: formData
      })
        .then(function (response) {
          return response.json();
        })
        .then(function (data) {
          if (data.success && data.whatsapp_url) {
            // Show success state
            if (btnSubmit) {
              btnSubmit.classList.add('success');
              if (btnSubmitText) {
                btnSubmitText.textContent = 'Redirecting to WhatsApp...';
              }
            }
            // Redirect to WhatsApp
            setTimeout(function () {
              window.open(data.whatsapp_url, '_blank');
              // Reset form
              contactForm.reset();
              if (btnSubmit) {
                btnSubmit.disabled = false;
                btnSubmit.classList.remove('success');
                if (btnSubmitText) {
                  btnSubmitText.textContent = 'Send via WhatsApp';
                }
              }
            }, 1000);
          } else {
            throw new Error('Unexpected response');
          }
        })
        .catch(function (error) {
          console.error('Error:', error);
          if (btnSubmit) {
            btnSubmit.disabled = false;
            if (btnSubmitText) {
              btnSubmitText.textContent = 'Send via WhatsApp';
            }
          }
          // Fallback: construct WhatsApp URL manually
          var name = formData.get('name') || '';
          var email = formData.get('email') || '';
          var phone = formData.get('phone') || '';
          var message = formData.get('message') || '';
          var whatsappMsg = 'Hello Scollarly!%0A%0A'
            + '*Name:* ' + encodeURIComponent(name) + '%0A'
            + '*Email:* ' + encodeURIComponent(email) + '%0A'
            + '*Phone:* ' + encodeURIComponent(phone) + '%0A'
            + '*Message:* ' + encodeURIComponent(message);
          window.open('https://wa.me/237651232301?text=' + whatsappMsg, '_blank');
        });
    });
  }

  // ─── Hero Parallax ───
  var heroBgImg = document.querySelector('.hero-bg-img');
  if (heroBgImg) {
    window.addEventListener('scroll', function () {
      var scrolled = window.pageYOffset;
      if (scrolled < window.innerHeight) {
        heroBgImg.style.transform = 'scale(1.1) translateY(' + (scrolled * 0.3) + 'px)';
      }
    }, { passive: true });
  }

  // ─── Smooth Scroll for Anchor Links ───
  document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
    anchor.addEventListener('click', function (e) {
      var targetId = this.getAttribute('href');
      if (targetId && targetId !== '#') {
        var target = document.querySelector(targetId);
        if (target) {
          e.preventDefault();
          var navHeight = document.querySelector('.nav') ? document.querySelector('.nav').offsetHeight : 0;
          var targetPosition = target.getBoundingClientRect().top + window.pageYOffset - navHeight;
          window.scrollTo({
            top: targetPosition,
            behavior: 'smooth'
          });
        }
      }
    });
  });

  // ─── Nav Scroll Effect ───
  var nav = document.getElementById('nav');
  if (nav) {
    window.addEventListener('scroll', function () {
      if (window.scrollY > 50) {
        nav.style.boxShadow = '0 4px 20px rgba(0,0,0,0.1)';
      } else {
        nav.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)';
      }
    }, { passive: true });
  }

  // ─── Animated Counters ───
  function animateCounter(el, target, duration) {
    var start = 0;
    var startTime = null;
    function step(timestamp) {
      if (!startTime) startTime = timestamp;
      var progress = Math.min((timestamp - startTime) / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.floor(start + (target - start) * eased);
      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        // Add the suffix back
        var suffix = el.getAttribute('data-suffix') || '';
        el.textContent = target + suffix;
      }
    }
    requestAnimationFrame(step);
  }

  var counterObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        var el = entry.target;
        var target = parseInt(el.getAttribute('data-target'), 10);
        if (!isNaN(target) && !el.classList.contains('counted')) {
          el.classList.add('counted');
          animateCounter(el, target, 2000);
        }
        counterObserver.unobserve(el);
      }
    });
  }, { threshold: 0.3 });

  document.querySelectorAll('.counter').forEach(function (el) {
    counterObserver.observe(el);
  });

  // ─── Staggered Delays for Cards ───
  document.querySelectorAll('.service-card, .university-card, .visa-card, .faq-item').forEach(function (el, i) {
    el.style.transitionDelay = (i * 80) + 'ms';
  });

  document.querySelectorAll('.stat-item').forEach(function (el, i) {
    el.style.transitionDelay = (i * 150) + 'ms';
  });

  document.querySelectorAll('.timeline-step').forEach(function (el, i) {
    el.style.transitionDelay = (i * 150) + 'ms';
  });

  document.querySelectorAll('.contact-item').forEach(function (el, i) {
    el.style.transitionDelay = (300 + i * 100) + 'ms';
  });

});
