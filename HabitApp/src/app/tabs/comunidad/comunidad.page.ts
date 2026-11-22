import { Component, OnInit, OnDestroy, ChangeDetectorRef, inject } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { Subscription, filter } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent, ToastController } from '@ionic/angular';
import { AuthService } from '../../core/auth.service';
import { ComunidadService } from '../../services/comunidad.service';
import { Post, NuevoPost, Comentario } from '../../models/comunidad.model';

const COLORES_AVATAR = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6'];

@Component({
  selector: 'app-comunidad',
  standalone: true,
  templateUrl: './comunidad.page.html',
  styleUrls: ['./comunidad.page.scss'],
  imports: [CommonModule, FormsModule, IonContent],
})
export class ComunidadPage implements OnInit, OnDestroy {
  private cdr = inject(ChangeDetectorRef);
  private navSub?: Subscription;
  selectedSegment: 'todas' | 'comunidad' | 'administracion' = 'todas';
  isModalOpen = false;
  posts: Post[] = [];
  private unsubscribe?: () => void;
  private uid = '';

  // Los residentes solo publican en "comunidad"
  newPost: NuevoPost = { title: '', body: '', category: 'comunidad' };

  animandoId = '';

  postAbierto: Post | null = null;
  comentarios: Comentario[] = [];
  cargandoComentarios = false;
  nuevoComentario = '';
  enviando = false;
  private unsubComentarios?: () => void;

  constructor(
    private toastCtrl: ToastController,
    private authService: AuthService,
    private comunidadService: ComunidadService,
    private router: Router
  ) {}

  ngOnInit() {
    this.iniciar();
    this.navSub = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        if (e.urlAfterRedirects.includes('/tabs/comunidad')) this.iniciar();
      });
  }

  private iniciar() {
    this.cerrarComentarios();
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.posts = [];
    this.uid = this.authService.getCurrentUser()?.uid || '';
    this.unsubscribe = this.comunidadService.escucharPosts(this.uid, (posts) => {
      this.posts = posts;
      this.cdr.markForCheck();
    });
  }

  ngOnDestroy() {
    this.navSub?.unsubscribe();
    this.unsubscribe?.();
    this.unsubComentarios?.();
  }

  get filteredPosts(): Post[] {
    if (this.selectedSegment === 'todas') return this.posts;
    return this.posts.filter(p => p.category === this.selectedSegment);
  }

  tiempo(createdAt: any): string {
    if (!createdAt?.seconds) return 'Ahora';
    const diffMin = Math.floor((Date.now() - createdAt.seconds * 1000) / 60000);
    if (diffMin < 1) return 'Ahora';
    if (diffMin < 60) return `Hace ${diffMin} min`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `Hace ${diffH} h`;
    const dias = Math.floor(diffH / 24);
    return dias === 1 ? 'Hace 1 día' : `Hace ${dias} días`;
  }

  timeAgo(post: Post): string {
    return this.tiempo(post.createdAt);
  }

  iniciales(nombre: string): string {
    const partes = (nombre || 'U').trim().split(' ');
    return ((partes[0]?.[0] || 'U') + (partes[1]?.[0] || '')).toUpperCase();
  }

  colorAvatar(nombre: string): string {
    let h = 0;
    for (const ch of nombre || 'U') h = (h * 31 + ch.charCodeAt(0)) % 997;
    return COLORES_AVATAR[h % COLORES_AVATAR.length];
  }

  esMio(c: Comentario): boolean {
    return !!this.uid && c.authorUid === this.uid;
  }

  onSegmentChange(valor: 'todas' | 'comunidad' | 'administracion') {
    this.selectedSegment = valor;
  }

  async toggleLike(post: Post) {
    if (!this.uid) return;
    const estabaLiked = post.liked;

    post.liked = !estabaLiked;
    post.likes += estabaLiked ? -1 : 1;
    if (!estabaLiked) {
      this.animandoId = post.id;
      setTimeout(() => { this.animandoId = ''; this.cdr.markForCheck(); }, 450);
    }
    this.cdr.markForCheck();

    try {
      await this.comunidadService.toggleLike(post.id, this.uid, estabaLiked);
    } catch (error) {
      post.liked = estabaLiked;
      post.likes += estabaLiked ? 1 : -1;
      this.cdr.markForCheck();
      const toast = await this.toastCtrl.create({ message: 'Error al procesar el like', duration: 1600, color: 'danger' });
      await toast.present();
    }
  }

  abrirComentarios(post: Post) {
    this.unsubComentarios?.();
    this.postAbierto = post;
    this.comentarios = [];
    this.nuevoComentario = '';
    this.cargandoComentarios = true;
    this.cdr.markForCheck();

    this.unsubComentarios = this.comunidadService.escucharComentarios(
      post.id,
      (lista) => {
        this.comentarios = lista;
        this.cargandoComentarios = false;
        this.cdr.markForCheck();
        setTimeout(() => this.scrollAbajo(), 60);
      },
      () => {
        this.cargandoComentarios = false;
        this.cdr.markForCheck();
      }
    );
  }

  cerrarComentarios() {
    this.unsubComentarios?.();
    this.unsubComentarios = undefined;
    this.postAbierto = null;
    this.comentarios = [];
    this.nuevoComentario = '';
    this.cdr.markForCheck();
  }

  async enviarComentario() {
    const texto = this.nuevoComentario.trim();
    if (!texto || this.enviando || !this.postAbierto) return;

    const user = this.authService.getCurrentUser();
    const authorName = user?.displayName || user?.email || 'Usuario';

    this.enviando = true;
    this.cdr.markForCheck();
    try {
      await this.comunidadService.agregarComentario(this.postAbierto.id, texto, authorName, this.uid);
      this.nuevoComentario = '';
    } catch (error) {
      const toast = await this.toastCtrl.create({ message: 'No se pudo enviar el comentario', duration: 1800, color: 'danger' });
      await toast.present();
    } finally {
      this.enviando = false;
      this.cdr.markForCheck();
    }
  }

  private scrollAbajo() {
    const el = document.getElementById('cm-lista');
    if (el) el.scrollTop = el.scrollHeight;
  }

  async sharePost(post: Post) {
    const shareData = { title: post.title, text: post.body };
    if ((navigator as any).share) {
      try { await (navigator as any).share(shareData); } catch { /* cancelado */ }
    } else {
      await navigator.clipboard.writeText(`${post.title}\n${post.body}`);
      const toast = await this.toastCtrl.create({ message: 'Publicación copiada al portapapeles', duration: 1800 });
      await toast.present();
    }
  }

  openNewPostModal() {
    this.newPost = { title: '', body: '', category: 'comunidad' };
    this.isModalOpen = true;
  }

  closeModal() { this.isModalOpen = false; this.cdr.markForCheck(); }

  async submitPost() {
    if (!this.newPost.title.trim() || !this.newPost.body.trim()) {
      const toast = await this.toastCtrl.create({ message: 'Completa el título y la descripción', duration: 1800, color: 'warning' });
      await toast.present();
      return;
    }

    try {
      const user = this.authService.getCurrentUser();
      const author = user?.displayName || user?.email || 'Usuario';
      this.newPost.category = 'comunidad';
      await this.comunidadService.crearPost(this.uid, author, this.newPost);

      this.isModalOpen = false; this.cdr.markForCheck();
      const toast = await this.toastCtrl.create({ message: 'Publicación creada', duration: 1500, color: 'success' });
      await toast.present();
    } catch (error) {
      const toast = await this.toastCtrl.create({ message: 'Error al crear la publicación', duration: 2000, color: 'danger' });
      await toast.present();
    }
  }
}