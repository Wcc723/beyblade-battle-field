<script setup lang="ts">
import { useRouter } from "vue-router";
import BeybladeAdmin from "../components/BeybladeAdmin.vue";

const router = useRouter();
</script>

<template>
  <BeybladeAdmin @go-battle="router.push('/test/battle')" />
</template>
